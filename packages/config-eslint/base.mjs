import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const sharedIgnores = [
  "**/.next/**",
  "**/.turbo/**",
  "**/coverage/**",
  "**/dist/**",
  "**/eslint.config.mjs",
  "**/next-env.d.ts",
  "**/node_modules/**",
  "**/generated/**",
  "**/next.config.ts",
  "**/postcss.config.mjs",
  "**/prisma.config.ts",
  "**/vite.config.ts"
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
