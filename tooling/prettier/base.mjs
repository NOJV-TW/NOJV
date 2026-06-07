import { fileURLToPath } from "node:url";

const sveltePlugin = fileURLToPath(import.meta.resolve("prettier-plugin-svelte"));

const config = {
  printWidth: 96,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  plugins: [sveltePlugin],
  overrides: [{ files: "*.svelte", options: { parser: "svelte" } }],
};

export default config;
