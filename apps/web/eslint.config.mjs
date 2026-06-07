import globals from "globals";
import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tseslint from "typescript-eslint";

import baseConfig from "../../eslint.config.mjs";

// Component sandbox: Svelte components must never import server-only
// modules. SvelteKit only enforces this for the `*.server.ts` suffix;
// we additionally block the worker / scheduling packages that have no
// business reaching the browser.
const componentSandboxRule = [
  "error",
  {
    paths: ["@nojv/temporal"].map((name) => ({
      name,
      message: `${name} is server-only — do not import from Svelte components. Move the call to a +page.server.ts / +layout.server.ts / API route and pass data via the load function.`,
    })),
    patterns: [
      {
        group: ["**/*.server", "**/*.server.ts", "**/*.server.js"],
        message:
          "Server-only modules (*.server.ts) must not be imported from Svelte components. Move the call to a server load/action and pass data through.",
      },
      // Layer boundary (also enforced in the wider rule below): db / redis
      // / storage are vertical layers reached through @nojv/domain.
      {
        group: [
          "@nojv/db",
          "@nojv/db/*",
          "@nojv/redis",
          "@nojv/redis/*",
          "@nojv/storage",
          "@nojv/storage/*",
        ],
        message:
          "apps/web components must not touch @nojv/db, @nojv/redis, or @nojv/storage. Move the call to a server load/action and pass typed data through.",
      },
    ],
  },
];

// Layer boundary for non-component web code: routes, loaders, actions,
// $lib/server helpers — all should reach db / redis / storage through
// @nojv/domain. A small allow-list of framework adapters lives in the
// third config block below.
const layerBoundaryRule = [
  "error",
  {
    patterns: [
      {
        group: ["@nojv/db", "@nojv/db/*"],
        message:
          "apps/web should go through @nojv/domain. The only exception is src/lib/auth.server.ts (better-auth Prisma adapter).",
      },
      {
        group: ["@nojv/redis", "@nojv/redis/*"],
        message:
          "apps/web should go through @nojv/domain. Exceptions: src/lib/server/shared/rate-limiter.ts and src/routes/api/events/stream/+server.ts.",
      },
      {
        group: ["@nojv/storage", "@nojv/storage/*"],
        message:
          "apps/web should go through @nojv/domain or src/lib/server/storage/* adapters.",
      },
    ],
  },
];

// Architectural layer rule: primitives/ is domain-agnostic and must
// never reach into features/. features/ may freely import primitives/.
// Combined with componentSandboxRule below for primitives files.
const primitivesNoFeaturesRule = [
  "error",
  {
    paths: ["@nojv/temporal"].map((name) => ({
      name,
      message: `${name} is server-only — do not import from Svelte components. Move the call to a +page.server.ts / +layout.server.ts / API route and pass data via the load function.`,
    })),
    patterns: [
      {
        group: ["**/*.server", "**/*.server.ts", "**/*.server.js"],
        message:
          "Server-only modules (*.server.ts) must not be imported from Svelte components. Move the call to a server load/action and pass data through.",
      },
      {
        group: [
          "@nojv/db",
          "@nojv/db/*",
          "@nojv/redis",
          "@nojv/redis/*",
          "@nojv/storage",
          "@nojv/storage/*",
        ],
        message:
          "apps/web components must not touch @nojv/db, @nojv/redis, or @nojv/storage. Move the call to a server load/action and pass typed data through.",
      },
      {
        group: ["$lib/components/features/*", "**/components/features/**"],
        message:
          "Primitives must not import from features (architectural layer rule). Primitives are domain-agnostic; if you need domain shape, move the component to features/.",
      },
    ],
  },
];

export default [
  ...baseConfig,
  // Svelte single-file components: register the parser so the layer
  // guard rules below can also block bad imports from inside *.svelte
  // <script> blocks. Without this block ESLint silently skips them.
  //
  // IMPORTANT: type-aware linting (`projectService`) is NOT enabled for
  // *.svelte files — turning it on hangs ESLint for tens of minutes on
  // this codebase. The base config's strict-type-checked rules require
  // type info, so we disable every type-aware rule for *.svelte and
  // rely on `svelte-check` for type errors in component files. ESLint
  // here only enforces the no-restricted-imports layer rules below.
  {
    files: ["src/**/*.svelte"],
    plugins: {
      svelte: sveltePlugin,
    },
    languageOptions: {
      parser: svelteParser,
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
        // Defensive: ensure no project-aware parse is attempted even if
        // a future base-config edit re-enables it. svelte-eslint-parser
        // forwards parserOptions to the underlying TS parser.
        project: null,
        projectService: false,
      },
    },
    rules: {
      // Disable type-aware rules in *.svelte — they require
      // `projectService`, which is too slow for this many components.
      ...Object.fromEntries(
        Object.keys(tseslint.configs.disableTypeChecked.rules ?? {}).map((name) => [
          name,
          "off",
        ]),
      ),
      // Pre-existing patterns in Svelte components that aren't worth
      // mass-fixing as part of enabling this parser. `svelte-check`
      // catches the same surface area for type / unused issues.
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-empty-function": "off",
      // `<script module>` re-exports like `export type { Foo }` get
      // misread by svelte-eslint-parser as import-assignment. The TS
      // compiler is the authority on type-only re-exports.
      "no-import-assign": "off",
      // Reactive-state assignments often write a value that is read by
      // a `$effect` / template binding the linter can't see across the
      // module boundary.
      "no-useless-assignment": "off",
    },
  },
  {
    files: [
      "src/lib/components/**/*.ts",
      "src/lib/components/**/*.tsx",
      "src/lib/components/**/*.svelte",
    ],
    rules: {
      "no-restricted-imports": componentSandboxRule,
    },
  },
  // Primitives layer guard. Now extended to *.svelte so the
  // primitives → features import boundary is enforced on the actual
  // component files, not just their TS companions.
  {
    files: [
      "src/lib/components/primitives/**/*.ts",
      "src/lib/components/primitives/**/*.tsx",
      "src/lib/components/primitives/**/*.svelte",
    ],
    rules: {
      "no-restricted-imports": primitivesNoFeaturesRule,
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.svelte"],
    ignores: [
      "src/lib/components/**/*.ts",
      "src/lib/components/**/*.tsx",
      "src/lib/components/**/*.svelte",
    ],
    rules: {
      "no-restricted-imports": layerBoundaryRule,
    },
  },
  // Documented exceptions: framework adapters and infrastructure clients
  // that legitimately need raw access to db / redis / storage.
  {
    files: [
      // better-auth Prisma adapter + placeholder-merge user hook need a
      // raw PrismaClient and `userRepo`.
      "src/lib/auth.server.ts",
      // Web-layer storage adapters that wrap @nojv/storage for routes.
      "src/lib/server/storage/**/*.ts",
      // RateLimiterRedis needs the raw ioredis client.
      "src/lib/server/shared/rate-limiter.ts",
      // SSE endpoint owns a per-request Redis subscriber.
      "src/routes/api/events/stream/+server.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
