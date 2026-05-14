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

export default [
  ...baseConfig,
  {
    files: ["src/lib/components/**/*.ts", "src/lib/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": componentSandboxRule,
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
