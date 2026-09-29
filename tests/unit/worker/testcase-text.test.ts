import { describe, expect, it, vi } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { loadSandboxTestcases } from "../../../apps/worker/src/sandbox/shared/testcase-text";

const request: SandboxRequest = {
  submissionId: "s",
  sourceCode: "",
  language: "python",
  problemType: "full_source",
  testcases: [
    {
      index: 0,
      input: { key: "in", sha256: "a".repeat(64), size: 4 },
      output: "3\n",
      weight: 1,
      isSample: false,
    },
  ],
  judgeType: "standard",
  judgeConfig: {},
  limits: { timeoutMs: 1_000, memoryMb: 128 },
};

describe("loadSandboxTestcases", () => {
  it("reads pinned testcase objects into text for backends that write files inline", async () => {
    const read = vi.fn(async () => Buffer.from("1 2\n"));
    const loaded = await loadSandboxTestcases(request, read);
    expect(loaded.testcases[0]).toMatchObject({ input: "1 2\n", output: "3\n" });
    expect(read).toHaveBeenCalledOnce();
  });

  it("fails without a reader instead of writing an empty testcase", async () => {
    await expect(loadSandboxTestcases(request, undefined)).rejects.toThrow("in");
  });
});
