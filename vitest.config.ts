import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sharedAliases = {
  $lib: path.resolve(__dirname, "apps/web/src/lib"),
  "@nojv/db": path.resolve(__dirname, "packages/db/src/index.ts"),
  "@nojv/core": path.resolve(__dirname, "packages/core/src/index.ts")
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: sharedAliases },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node"
        }
      },
      {
        resolve: { alias: sharedAliases },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/global-setup.ts"],
          setupFiles: ["tests/setup/integration-setup.ts"]
        }
      }
    ]
  }
});
