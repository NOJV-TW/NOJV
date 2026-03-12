import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
      "@nojv/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
      "@nojv/core": path.resolve(__dirname, "../../packages/core/src/index.ts")
    }
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node"
  }
});
