import { describe, expect, it } from "vitest";

import { runSolution } from "../../../apps/sandbox-runner/src/judges/standard.js";
import type { TestcaseFiles } from "../../../apps/sandbox-runner/src/types.js";

describe("checker run phase (raw, no in-container checker)", () => {
  it("emits a raw run with no verdict on a clean solution run", async () => {
    const tc: TestcaseFiles = { index: 0, input: "hello\n", weight: 1, isSample: false };
    const run = await runSolution(
      ["node", "-e", "process.stdout.write(require('fs').readFileSync(0,'utf8'))"],
      tc,
      10_000,
    );

    expect(run).not.toHaveProperty("verdict");
    expect(run.errorVerdict).toBeUndefined();
    expect(run.stdout).toBe("hello\n");
    expect(run.index).toBe(0);
  });
});
