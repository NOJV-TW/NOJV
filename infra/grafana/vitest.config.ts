import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Standalone vitest config for the grafana provisioning script tests.
// The root vitest.config.ts uses `projects` restricted to tests/unit + tests/integration,
// so tests colocated under infra/ are not picked up. This local config runs them directly.
// We pin the root to this directory so vitest does not walk up to the monorepo root and
// pick up unrelated test files under .claude/worktrees, packages/, or apps/.
export default defineConfig({
  root: __dirname,
  test: {
    include: ["**/*.test.ts"],
    environment: "node",
  },
});
