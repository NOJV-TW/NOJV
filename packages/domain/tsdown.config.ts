import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  // DTS disabled: this is a private monorepo package with "types" pointing to source TS.
  // Consumers resolve types from src/index.ts directly; DTS generation would require
  // re-exporting all transitive Prisma types which is unnecessary overhead.
  dts: false
});
