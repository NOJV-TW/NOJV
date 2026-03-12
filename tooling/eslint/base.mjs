import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const sharedIgnores = [
  "**/.svelte-kit/**",
  "**/.turbo/**",
  "**/build/**",
  "**/coverage/**",
  "**/dist/**",
  "**/eslint.config.mjs",
  "**/node_modules/**",
  "**/generated/**",
  "**/paraglide/**",
  "**/playwright.config.ts",
  "**/postcss.config.mjs",
  "**/prisma/**",
  "**/prisma.config.ts",
  "**/svelte.config.js",
  "**/tsdown.config.ts",
  "**/vite.config.ts",
  "**/vitest.config.ts"
];

export const baseConfig = [
  {
    ignores: sharedIgnores
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.node
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd()
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports"
        }
      ],
      "@typescript-eslint/no-confusing-void-expression": "off"
    }
  }
];

export default baseConfig;
