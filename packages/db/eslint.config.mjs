import { baseConfig } from "@nojv/eslint-config/base";

export default [
  ...baseConfig,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@nojv/application",
                "@nojv/application/*",
                "@nojv/mailer",
                "@nojv/mailer/*",
                "@nojv/temporal",
                "@nojv/temporal/*",
                "@nojv/redis",
                "@nojv/redis/*",
                "@nojv/storage",
                "@nojv/storage/*",
              ],
              message:
                "@nojv/db source is the persistence layer: it may use core contracts but must not depend on application or infrastructure above it. Prisma seed/maintenance scripts are outside src/.",
            },
          ],
        },
      ],
    },
  },
];
