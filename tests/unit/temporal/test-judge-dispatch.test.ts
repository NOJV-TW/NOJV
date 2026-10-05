import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TimeoutFailure,
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
} from "@temporalio/client";

const { execute, start } = vi.hoisted(() => ({ execute: vi.fn(), start: vi.fn() }));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn(async () => ({ workflow: { execute, start } })),
}));

import {
  dispatchTestJudgeProgramBuild,
  runTestJudgeWorkflow,
} from "../../../packages/temporal/src/dispatch";

const sha256 = "a".repeat(64);
const buildInput = {
  role: "checker" as const,
  language: "cpp" as const,
  scriptPointer: { key: `judge-scripts/${sha256}`, sha256, size: 12 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTestJudgeWorkflow", () => {
  it("executes the test-judge workflow on its queue with a hard deadline and returns its output", async () => {
    const output = { ok: true, cases: [] };
    execute.mockResolvedValueOnce(output);

    await expect(
      runTestJudgeWorkflow({ requestKey: "req" }, { timeoutMs: 30_000 }),
    ).resolves.toBe(output);

    expect(execute).toHaveBeenCalledWith("testJudgeWorkflow", {
      taskQueue: "test-judge",
      workflowId: expect.stringMatching(/^test-judge-[0-9a-f-]{36}$/) as unknown,
      args: [{ requestKey: "req" }],
      workflowExecutionTimeout: 30_000,
    });
  });

  it("gives every request its own workflow id", async () => {
    execute.mockResolvedValue({ ok: true, cases: [] });

    await runTestJudgeWorkflow({ requestKey: "a" }, { timeoutMs: 1_000 });
    await runTestJudgeWorkflow({ requestKey: "a" }, { timeoutMs: 1_000 });

    const ids = execute.mock.calls.map(
      (call) => (call[1] as { workflowId: string }).workflowId,
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("reports a timed-out or failed workflow as busy", async () => {
    execute.mockRejectedValueOnce(
      new WorkflowFailedError(
        "Workflow execution timed out",
        new TimeoutFailure("Workflow execution timed out", undefined, "START_TO_CLOSE"),
        "TIMEOUT",
      ),
    );

    await expect(
      runTestJudgeWorkflow({ requestKey: "req" }, { timeoutMs: 30_000 }),
    ).resolves.toEqual({ ok: false, code: "test_judge_busy" });
  });

  it("lets connection errors reach the caller", async () => {
    execute.mockRejectedValueOnce(new Error("temporal down"));

    await expect(
      runTestJudgeWorkflow({ requestKey: "req" }, { timeoutMs: 30_000 }),
    ).rejects.toThrow("temporal down");
  });
});

describe("dispatchTestJudgeProgramBuild", () => {
  it("starts the build on the test-judge queue with an id derived from its build inputs", async () => {
    start.mockResolvedValueOnce(undefined);

    await dispatchTestJudgeProgramBuild(buildInput);

    expect(start).toHaveBeenCalledWith("testJudgeProgramBuildWorkflow", {
      taskQueue: "test-judge",
      workflowId: `test-judge-build-checker-cpp-${sha256}`,
      workflowIdConflictPolicy: "USE_EXISTING",
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
      args: [buildInput],
    });
  });

  it("treats an already running build of the same script as dispatched", async () => {
    start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        "already started",
        `test-judge-build-checker-cpp-${sha256}`,
        "testJudgeProgramBuildWorkflow",
      ),
    );

    await expect(dispatchTestJudgeProgramBuild(buildInput)).resolves.toBeUndefined();
  });

  it("rethrows unexpected start failures", async () => {
    start.mockRejectedValueOnce(new Error("temporal down"));

    await expect(dispatchTestJudgeProgramBuild(buildInput)).rejects.toThrow("temporal down");
  });
});
