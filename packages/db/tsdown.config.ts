import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  clean: true,
  deps: {
    neverBundle: ["@prisma/client", "@prisma/adapter-pg"],
  },
});
