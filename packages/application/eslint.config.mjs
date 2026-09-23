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
                "@nojv/temporal",
                "@nojv/temporal/*",
                "@temporalio/*",
                "@sveltejs/kit",
                "@sveltejs/kit/*",
              ],
              message:
                "@nojv/application owns product rules and an orchestration port; framework routes and Temporal adapters belong in the apps.",
            },
          ],
        },
      ],
    },
  },
];
