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
              group: ["@nojv/*", "@nojv/**"],
              message:
                "@nojv/core is the dependency root and must not import workspace packages.",
            },
          ],
        },
      ],
    },
  },
];
