import baseConfig from "../../eslint.config.mjs";

const serverOnlyPackages = ["@nojv/db", "@nojv/redis", "@nojv/temporal", "@nojv/job-dispatch"];

const restrictedImportsRule = [
  "error",
  {
    paths: serverOnlyPackages.map((name) => ({
      name,
      message: `${name} is server-only — do not import from Svelte components. Move the call to a +page.server.ts / +layout.server.ts / API route and pass data via the load function.`,
    })),
    patterns: [
      {
        group: ["**/*.server", "**/*.server.ts", "**/*.server.js"],
        message:
          "Server-only modules (*.server.ts) must not be imported from Svelte components. Move the call to a server load/action and pass data through.",
      },
    ],
  },
];

export default [
  ...baseConfig,
  {
    files: ["src/lib/components/**/*.ts", "src/lib/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": restrictedImportsRule,
    },
  },
];
