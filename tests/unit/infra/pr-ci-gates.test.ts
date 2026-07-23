import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("pull-request runtime gates", () => {
  it.each(["ci.yml", "codeql.yml", "image-build.yml"])(
    "does not persist checkout credentials in %s",
    (name) => {
      const workflow = readFileSync(join(repoRoot, ".github/workflows", name), "utf8");
      const checkoutCount = workflow.match(/uses: actions\/checkout@/gu)?.length ?? 0;
      const disabledCount = workflow.match(/persist-credentials: false/gu)?.length ?? 0;

      expect(checkoutCount).toBeGreaterThan(0);
      expect(disabledCount).toBe(checkoutCount);
    },
  );

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

  it("runs repository verification and coverage in parallel jobs", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const verify = workflow.slice(
      workflow.indexOf("  verify:"),
      workflow.indexOf("  coverage:"),
    );
    const coverage = workflow.slice(
      workflow.indexOf("  coverage:"),
      workflow.indexOf("  verify-gate:"),
    );
    const gate = workflow.slice(
      workflow.indexOf("  verify-gate:"),
      workflow.indexOf("  security-audit:"),
    );

    expect(verify).toContain("pnpm ci:verify");
    expect(verify).not.toContain("pnpm test:coverage");
    expect(coverage).toContain("pnpm test:coverage");
    expect(coverage).not.toMatch(/^\s+needs:/mu);
    for (const prerequisite of [
      "pnpm --filter @nojv/storage... build",
      "pnpm --filter @nojv/web paraglide:compile",
      "pnpm --filter @nojv/web exec svelte-kit sync",
    ]) {
      expect(coverage).toContain(prerequisite);
      expect(coverage.indexOf(prerequisite)).toBeLessThan(
        coverage.indexOf("pnpm test:coverage"),
      );
    }
    expect(gate).toContain("name: Verify Repository");
    expect(gate).toContain("if: always()");
    expect(gate).toMatch(/needs:\s*\n\s+- verify\s*\n\s+- coverage/u);
    expect(gate).toContain('test "$VERIFY_RESULT" = success');
    expect(gate).toContain('test "$COVERAGE_RESULT" = success');
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
