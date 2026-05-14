import baseConfig from "../../eslint.config.mjs";

// Component sandbox: Svelte components must never import server-only
// modules. SvelteKit only enforces this for the `*.server.ts` suffix;
// we additionally block the worker / scheduling packages that have no
// business reaching the browser.
const componentSandboxRule = [
  "error",
  {
    paths: ["@nojv/temporal", "@nojv/job-dispatch"].map((name) => ({
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
    paths: ["@nojv/temporal", "@nojv/job-dispatch"].map((name) => ({
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
  {
    files: ["src/lib/components/**/*.ts", "src/lib/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": componentSandboxRule,
    },
  },
  // Primitives layer guard: ESLint in this repo only parses .ts / .tsx
  // (Svelte single-file components are silently ignored — see eslint
  // `--print-config` against any *.svelte file). The TS-companion files
  // under primitives/ are still covered, and the architectural intent is
  // documented for human reviewers. Listed AFTER the broader components
  // rule so it overrides for the narrower file set.
  {
    files: ["src/lib/components/primitives/**/*.ts", "src/lib/components/primitives/**/*.tsx"],
    rules: {
      "no-restricted-imports": primitivesNoFeaturesRule,
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/components/**/*.ts", "src/lib/components/**/*.tsx"],
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
