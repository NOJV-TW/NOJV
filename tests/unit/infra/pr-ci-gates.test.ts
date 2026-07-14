import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("pull-request runtime gates", () => {
  it("runs named core browser flows against isolated services", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain("browser-smoke:");
    expect(workflow).toContain("name: Core browser smoke");
    expect(workflow).toContain("POSTGRES_DB: nojv_e2e_test");
    expect(workflow).toContain("NOJV_DESTRUCTIVE_TEST_DATABASE: nojv_e2e_test");
    expect(workflow).toContain("playwright install --with-deps chromium");
    for (const file of ["auth.test.ts", "dashboard.test.ts", "problems.test.ts"]) {
      expect(workflow).toContain(`tests/e2e/${file}`);
    }
  });

  it("runs an unconditional real Docker sandbox boundary smoke on every PR", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/image-build.yml"), "utf8");
    const smoke = workflow.slice(
      workflow.indexOf("  sandbox-smoke:"),
      workflow.indexOf("  classify:"),
    );

    expect(smoke).toContain("name: PR sandbox smoke");
    expect(smoke).not.toMatch(/^\s+if:/mu);
    expect(smoke).toContain("docker build -f infra/docker/sandbox-runner.Dockerfile");
    for (const flag of [
      "--network none",
      "--user 10001:10001",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--read-only",
      "--pids-limit 64",
    ]) {
      expect(smoke).toContain(flag);
    }
  });
});
