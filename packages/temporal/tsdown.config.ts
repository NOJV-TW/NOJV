import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/workflows/index.ts",
    "src/activities/index.ts",
    "src/activities/judge-bundle.ts",
    "src/activities/platform-bundle.ts"
  ],
  format: "esm",
  dts: false
});
