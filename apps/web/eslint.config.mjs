import globals from "globals";
import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tseslint from "typescript-eslint";

import baseConfig from "../../eslint.config.mjs";

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
        group: ["@nojv/application", "@nojv/application/*"],
        allowTypeImports: true,
        message:
          "@nojv/application value-imports pull Prisma/ioredis into the client bundle. Svelte components may only `import type` from it — move runtime calls to a +page.server.ts / API route and pass data through.",
      },
    ],
  },
];

const layerBoundaryTemporalPath = {
  name: "@nojv/temporal",
  message:
    "@nojv/temporal is server-only and reached through @nojv/application (dispatch helpers). Do not import it from apps/web.",
};

const layerBoundaryDbPattern = {
  group: ["@nojv/db", "@nojv/db/*"],
  message:
    "apps/web should go through @nojv/application. The only exception is src/lib/auth.server.ts (better-auth Prisma adapter).",
};

const layerBoundaryRedisPattern = {
  group: ["@nojv/redis", "@nojv/redis/*"],
  message:
    "apps/web should go through @nojv/application. Exceptions: src/lib/server/shared/rate-limiter.ts and src/routes/api/events/stream/+server.ts.",
};

const layerBoundaryStoragePattern = {
  group: ["@nojv/storage", "@nojv/storage/*"],
  message: "apps/web should go through @nojv/application or src/lib/server/storage/* adapters.",
};

function layerBoundaryRule({
  allowTemporal = false,
  allowDb = false,
  allowRedis = false,
  allowStorage = false,
} = {}) {
  const patterns = [];
  if (!allowDb) patterns.push(layerBoundaryDbPattern);
  if (!allowRedis) patterns.push(layerBoundaryRedisPattern);
  if (!allowStorage) patterns.push(layerBoundaryStoragePattern);
  return [
    "error",
    {
      paths: allowTemporal ? [] : [layerBoundaryTemporalPath],
      patterns,
    },
  ];
}

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
        group: ["@nojv/application", "@nojv/application/*"],
        allowTypeImports: true,
        message:
          "@nojv/application value-imports pull Prisma/ioredis into the client bundle. Svelte components may only `import type` from it — move runtime calls to a +page.server.ts / API route and pass data through.",
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
        project: null,
        projectService: false,
      },
    },
    rules: {
      ...Object.fromEntries(
        Object.keys(tseslint.configs.disableTypeChecked.rules ?? {}).map((name) => [
          name,
          "off",
        ]),
      ),
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-empty-function": "off",
      "no-import-assign": "off",
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
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": componentSandboxRule,
    },
  },
  {
    files: [
      "src/lib/components/primitives/**/*.ts",
      "src/lib/components/primitives/**/*.tsx",
      "src/lib/components/primitives/**/*.svelte",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": primitivesNoFeaturesRule,
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
      "no-restricted-imports": layerBoundaryRule(),
    },
  },
  {
    files: ["src/lib/auth.server.ts"],
    rules: {
      "no-restricted-imports": layerBoundaryRule({ allowDb: true, allowRedis: true }),
    },
  },
  {
    files: ["src/lib/server/domain-orchestration.ts"],
    rules: {
      "no-restricted-imports": layerBoundaryRule({ allowTemporal: true }),
    },
  },
  {
    files: ["src/lib/server/storage/**/*.ts"],
    rules: {
      "no-restricted-imports": layerBoundaryRule({ allowStorage: true }),
    },
  },
  {
    files: [
      "src/lib/server/shared/rate-limiter.ts",
      "src/lib/server/shared/sse-hub.ts",
      "src/routes/api/events/stream/+server.ts",
      "src/routes/**/scoreboard/stream/+server.ts",
    ],
    rules: {
      "no-restricted-imports": layerBoundaryRule({ allowRedis: true }),
    },
  },
];
