import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const requireFromMailer = createRequire(path.join(__dirname, "packages/mailer/package.json"));
const requireFromWeb = createRequire(path.join(__dirname, "apps/web/package.json"));
const requireFromTemporal = createRequire(
  path.join(__dirname, "packages/temporal/package.json"),
);

const sharedAliases = {
  $lib: path.resolve(__dirname, "apps/web/src/lib"),
  nodemailer: requireFromMailer.resolve("nodemailer"),
  jose: requireFromWeb.resolve("jose"),
  echarts: requireFromWeb.resolve("echarts"),
  "@temporalio/client": requireFromTemporal.resolve("@temporalio/client"),
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
};

const componentAliases = [
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
      // worker/sandbox-runner floor is lower than domain/core because their
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
        resolve: { alias: sharedAliases },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          exclude: [
            "tests/unit/web/echart-lifecycle.test.ts",
            "tests/unit/web/clarification-tab-error.test.ts",
            "tests/unit/web/plagiarism-pair-diff.test.ts",
            "tests/unit/web/plagiarism-pair-diff-load-error.test.ts",
            "tests/unit/web/toggle-switch.test.ts",
          ],
          environment: "node",
        },
      },
      {
        plugins: [svelteTestPlugin()],
        resolve: { alias: componentAliases, conditions: ["browser"] },
        test: {
          name: "component",
          include: [
            "tests/unit/web/echart-lifecycle.test.ts",
            "tests/unit/web/clarification-tab-error.test.ts",
            "tests/unit/web/plagiarism-pair-diff.test.ts",
            "tests/unit/web/plagiarism-pair-diff-load-error.test.ts",
            "tests/unit/web/toggle-switch.test.ts",
          ],
          environment: "jsdom",
        },
      },
      {
        plugins: [svelteTestPlugin()],
        resolve: { alias: sharedAliases },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude: ["tests/integration/k8s/**/*.test.ts"],
          environment: "node",
          // Integration tests share a single Postgres + Redis. Running files
          // in parallel races on `truncateAllTables` (deadlock detected) and
          // creates FK violations when one file's truncate cascades through
          // another file's freshly inserted rows. Force serial execution to
          // keep the suite deterministic. Per-worker schemas would be required
          // before this suite can safely run files in parallel.
          fileParallelism: false,
          globalSetup: ["tests/setup/global-setup.ts"],
          setupFiles: ["tests/setup/integration-setup.ts"],
        },
      },
      {
        plugins: [svelteTestPlugin()],
        resolve: { alias: sharedAliases },
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
