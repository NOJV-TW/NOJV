import { baseConfig } from "@nojv/eslint-config/base";

export default [
  ...baseConfig,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: ["@nojv/redis", "@nojv/storage"].map((name) => ({
            name,
            message: `@nojv/db (persistence layer) must not import ${name}. Cache/storage sit above the DB and reach it through repositories. Seed/maintenance scripts under prisma/ are the only exception.`,
          })),
        },
      ],
    },
  },
];
