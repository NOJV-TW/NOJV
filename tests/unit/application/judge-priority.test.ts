import { describe, expect, it } from "vitest";

import { judgePriorityKey } from "../../../packages/core/src/judge-execution";

const base = { operationId: null as string | null, recoveryEpoch: 0, examId: null, contestId: null };

describe("judgePriorityKey", () => {
  it.each([
    [{ ...base, examId: "exam" }, 1],
    [{ ...base, contestId: "contest" }, 2],
    [{ ...base, examId: "exam", contestId: "contest" }, 1],
    [base, 3],
    [{ ...base, examId: "exam", recoveryEpoch: 1 }, 4],
    [{ ...base, recoveryEpoch: 2 }, 4],
    [{ ...base, operationId: "rejudge-1", examId: "exam" }, 5],
    [{ ...base, operationId: "rejudge-1", recoveryEpoch: 2 }, 5],
  ])("maps %j to priority %i", (execution, expected) => {
    expect(judgePriorityKey(execution)).toBe(expected);
  });
});
