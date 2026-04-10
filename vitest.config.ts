import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sharedAliases = {
  $lib: path.resolve(__dirname, "apps/web/src/lib"),
  "@nojv/db": path.resolve(__dirname, "packages/db/src/index.ts"),
  "@nojv/core": path.resolve(__dirname, "packages/core/src/index.ts"),
  "@nojv/domain": path.resolve(__dirname, "packages/domain/src/index.ts"),
  "@nojv/redis": path.resolve(__dirname, "packages/redis/src/index.ts")
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage"
    },
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
          // Integration tests share a single Postgres + Redis. Running files
          // in parallel races on `truncateAllTables` (deadlock detected) and
          // creates FK violations when one file's truncate cascades through
          // another file's freshly inserted rows. Force serial execution to
          // keep the suite deterministic. Per-worker schemas would let us
          // parallelise, but the gain is small for a 6-file suite.
          fileParallelism: false,
          globalSetup: ["tests/setup/global-setup.ts"],
          setupFiles: ["tests/setup/integration-setup.ts"]
        }
      }
    ]
  }
});
