import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const requireFromMailer = createRequire(path.join(__dirname, "packages/mailer/package.json"));
const requireFromStorage = createRequire(path.join(__dirname, "packages/storage/package.json"));
const requireFromWeb = createRequire(path.join(__dirname, "apps/web/package.json"));
const requireFromWorker = createRequire(path.join(__dirname, "apps/worker/package.json"));
const requireFromTemporal = createRequire(
  path.join(__dirname, "packages/temporal/package.json"),
);

const sharedAliases = {
  $lib: path.resolve(__dirname, "apps/web/src/lib"),
  nodemailer: requireFromMailer.resolve("nodemailer"),
  "@aws-sdk/client-s3": requireFromStorage.resolve("@aws-sdk/client-s3"),
  jose: requireFromWeb.resolve("jose"),
  echarts: requireFromWeb.resolve("echarts"),
  "sveltekit-superforms/server": requireFromWeb.resolve("sveltekit-superforms/server"),
  "sveltekit-superforms/adapters": requireFromWeb.resolve("sveltekit-superforms/adapters"),
  "sveltekit-superforms/client": requireFromWeb.resolve("sveltekit-superforms/client"),
  "sveltekit-superforms": requireFromWeb.resolve("sveltekit-superforms"),
  "@temporalio/client": requireFromTemporal.resolve("@temporalio/client"),
  "@temporalio/worker": requireFromWorker.resolve("@temporalio/worker"),
  "@temporalio/workflow": requireFromWorker.resolve("@temporalio/workflow"),
  "@nojv/db": path.resolve(__dirname, "packages/db/src/index.ts"),
  "@nojv/core": path.resolve(__dirname, "packages/core/src/index.ts"),
  "@nojv/application": path.resolve(__dirname, "packages/application/src/index.ts"),
  "@nojv/redis": path.resolve(__dirname, "packages/redis/src/index.ts"),
  "@nojv/temporal": path.resolve(__dirname, "packages/temporal/src/index.ts"),
  "@nojv/storage": path.resolve(__dirname, "packages/storage/src/index.ts"),
  "@nojv/mailer": path.resolve(__dirname, "packages/mailer/src/index.ts"),
  "@nojv/sandbox-docker": path.resolve(__dirname, "packages/sandbox-docker/src/index.ts"),
  "$env/dynamic/private": path.resolve(__dirname, "tests/setup/stubs/env-dynamic-private.ts"),
  "$env/dynamic/public": path.resolve(__dirname, "tests/setup/stubs/env-dynamic-public.ts"),
  "$app/environment": path.resolve(__dirname, "tests/setup/stubs/app-environment.ts"),
  "$app/navigation": path.resolve(__dirname, "tests/setup/stubs/app-navigation.ts"),
  "$app/state": path.resolve(__dirname, "tests/setup/stubs/app-state.ts"),
};

const componentAliases = [
  {
    find: "$app/stores",
    replacement: path.resolve(__dirname, "tests/component/web/fixtures/app-stores.ts"),
  },
  {
    find: "$app/forms",
    replacement: path.join(
      path.dirname(requireFromWeb.resolve("@sveltejs/kit/package.json")),
      "src/runtime/app/forms.js",
    ),
  },
  {
    find: /^@lucide\/svelte\/icons\/[^/]+$/,
    replacement: path.resolve(__dirname, "tests/fixtures/web/empty-component.svelte"),
  },
  {
    find: /^@lucide\/svelte\/icons\/mail$/,
    replacement: path.resolve(__dirname, "tests/fixtures/web/empty-component.svelte"),
  },
  {
    find: /^@lucide\/svelte$/,
    replacement: path.resolve(__dirname, "tests/fixtures/web/lucide.ts"),
  },
  {
    find: /^svelte$/,
    replacement: path.resolve(
      path.dirname(requireFromWeb.resolve("svelte/package.json")),
      "src/index-client.js",
    ),
  },
  ...Object.entries(sharedAliases).map(([find, replacement]) => ({ find, replacement })),
];

function svelteTestPlugin() {
  return svelte({ configFile: path.resolve(__dirname, "apps/web/svelte.config.js") });
}

export default defineConfig({
  test: {
    maxWorkers: "50%",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      // worker/sandbox-runner floor is lower than application/core because their
      // docker/k8s paths only run in the nightly real-image suite, not this gate.
      include: [
        "packages/application/src/**",
        "packages/core/src/**",
        "apps/worker/src/**",
        "apps/sandbox-runner/src/**",
      ],
      thresholds: {
        "packages/{application,core}/src/**": {
          lines: 68,
          statements: 65,
          functions: 62,
          branches: 58,
        },
        "apps/{worker,sandbox-runner}/src/**": {
          lines: 30,
          statements: 30,
          functions: 30,
          branches: 30,
        },
      },
    },
    projects: [
      {
        plugins: [svelteTestPlugin()],
        resolve: { alias: sharedAliases, dedupe: ["@sveltejs/kit"] },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          globalSetup: ["tests/setup/nojv-exec.ts"],
          environment: "node",
        },
      },
      {
        plugins: [svelteTestPlugin()],
        resolve: {
          alias: componentAliases,
          conditions: ["browser"],
          dedupe: ["@sveltejs/kit"],
        },
        test: {
          name: "component",
          server: { deps: { inline: ["bits-ui", "runed", "svelte-toolbelt"] } },
          include: ["tests/component/**/*.test.ts"],
          environment: "jsdom",
        },
      },
      {
        resolve: { alias: sharedAliases },
        test: {
          name: "sandbox-integration",
          include: ["tests/integration/judge/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
        },
      },
      {
        resolve: { alias: sharedAliases },
        test: {
          name: "temporal-integration",
          include: ["tests/integration/temporal/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
        },
      },
      {
        plugins: [svelteTestPlugin()],
        resolve: { alias: sharedAliases, dedupe: ["@sveltejs/kit"] },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude: [
            "tests/integration/k8s/**/*.test.ts",
            "tests/integration/temporal/**/*.test.ts",
            "tests/integration/judge/**/*.test.ts",
            "tests/integration/storage/**/*.test.ts",
          ],
          environment: "node",
          // Integration tests share a single Postgres + Redis. Running files
          // in parallel races on `truncateAllTables` (deadlock detected) and
          // creates FK violations when one file's truncate cascades through
          // another file's freshly inserted rows. Force serial execution to
          // keep the suite deterministic. Per-worker schemas would be required
          // before this suite can safely run files in parallel.
          fileParallelism: false,
          globalSetup: ["tests/setup/global-setup.ts", "tests/setup/nojv-exec.ts"],
          setupFiles: ["tests/setup/integration-setup.ts"],
        },
      },
      {
        resolve: { alias: sharedAliases },
        test: {
          name: "storage-conformance",
          include: ["tests/integration/storage/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 300_000,
        },
      },
      {
        plugins: [svelteTestPlugin()],
        resolve: { alias: sharedAliases, dedupe: ["@sveltejs/kit"] },
        test: {
          name: "k8s-integration",
          include: ["tests/integration/k8s/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          globalSetup: ["tests/setup/k8s-global-setup.ts"],
        },
      },
    ],
  },
});
