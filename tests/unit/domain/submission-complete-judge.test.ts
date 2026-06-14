import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryStorage } from "../_fixtures/storage";

const { submissionComplete, storageRef } = vi.hoisted(() => ({
  submissionComplete: vi.fn(),
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
}));

vi.mock("@nojv/db", () => ({
  Prisma: { JsonNull: { __jsonNull: true } },
  submissionRepo: {
    complete: submissionComplete,
  },
  problemRepo: { withTx: () => ({}) },
  userRepo: { withTx: () => ({}) },
  courseRepo: { withTx: () => ({}) },
  courseMembershipRepo: { withTx: () => ({}) },
  assessmentRepo: { withTx: () => ({}) },
  contestRepo: { withTx: () => ({}) },
  examSessionRepo: { withTx: () => ({}) },
  examRepo: { withTx: () => ({}) },
  problemWorkspaceFileRepo: {},
  submissionRejudgeLogRepo: {},
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
}));

vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
  __setStorageClientForTests: (c: unknown) => {
    storageRef.client = c as typeof storageRef.client;
  },
}));

import type { SubmissionResult } from "@nojv/core";
import { Prisma } from "@nojv/db";
import { submissionDomain } from "@nojv/application";

const { completeJudge, deriveVerdictSummary } = submissionDomain;

function makeResult(overrides: Partial<SubmissionResult> = {}): SubmissionResult {
  return {
    accepted: false,
    feedback: "ok",
    runtimeMs: 100,
    score: 0,
    verdict: "wrong_answer",
    ...overrides,
  } as SubmissionResult;
}

describe("deriveVerdictSummary", () => {
  it("tallies case verdicts (AC/WA/TLE/MLE/RE) and lumps anything else into other", () => {
    const summary = deriveVerdictSummary(
      makeResult({
        caseResults: [
          { index: 0, verdict: "AC", timeMs: 1 },
          { index: 1, verdict: "AC", timeMs: 1 },
          { index: 2, verdict: "WA", timeMs: 1 },
          { index: 3, verdict: "TLE", timeMs: 1 },
          { index: 4, verdict: "MLE", timeMs: 1 },
          { index: 5, verdict: "RE", timeMs: 1 },
          { index: 6, verdict: "CE", timeMs: 1 }, // not in core 5; falls into other
          { index: 7, verdict: "SE", timeMs: 1 }, // sandbox-error; other
        ],
      }),
    );
    expect(summary.caseSummary).toEqual({
      ac: 2,
      wa: 1,
      tle: 1,
      mle: 1,
      re: 1,
      other: 2,
    });
  });

  it("includes subtaskSummary only when subtaskResults is non-empty", () => {
    const empty = deriveVerdictSummary(makeResult());
    expect(empty.subtaskSummary).toBeUndefined();

    const withSubtasks = deriveVerdictSummary(
      makeResult({
        subtaskResults: [
          { testcaseSetId: "ts_1", label: "1", weight: 30, passed: true, cases: [] },
          { testcaseSetId: "ts_2", label: "2", weight: 70, passed: false, cases: [] },
        ],
      }),
    );
    expect(withSubtasks.subtaskSummary).toEqual([
      { id: "ts_1", score: 30 },
      { id: "ts_2", score: 0 },
    ]);
  });

  it("includes compilerErrorTruncated only on compile_error verdict, capped at 1 KB", () => {
    const noTruncation = deriveVerdictSummary(
      makeResult({ verdict: "wrong_answer", feedback: "long ".repeat(500) }),
    );
    expect(noTruncation.compilerErrorTruncated).toBeUndefined();

    const long = "x".repeat(2000);
    const ce = deriveVerdictSummary(makeResult({ verdict: "compile_error", feedback: long }));
    expect(ce.compilerErrorTruncated).toBeDefined();
    expect(ce.compilerErrorTruncated!.length).toBe(1024);
  });

  it("handles a result with zero caseResults — returns zeroed summary", () => {
    const summary = deriveVerdictSummary(makeResult());
    expect(summary.caseSummary).toEqual({ ac: 0, wa: 0, tle: 0, mle: 0, re: 0, other: 0 });
  });
});

describe("completeJudge — storage + DB write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageRef.client = createInMemoryStorage() as unknown as typeof storageRef.client;
  });

  it("writes the full result to S3 and persists summary + key on the DB row", async () => {
    const result = makeResult({
      verdict: "accepted",
      accepted: true,
      score: 100,
      runtimeMs: 42,
      memoryKb: 512,
      caseResults: [
        { index: 0, verdict: "AC", timeMs: 5 },
        { index: 1, verdict: "AC", timeMs: 7 },
      ],
    });
    submissionComplete.mockResolvedValue({
      id: "sub_1",
      contestId: null,
      examId: null,
      createdAt: new Date(),
      language: "python",
      problemId: "prob_1",
      sampleOnly: false,
      score: 100,
      status: "accepted",
      userId: "usr_1",
    });

    await completeJudge("sub_1", result);

    const store = (storageRef.client as unknown as { store: Map<string, string> }).store;
    expect([...store.keys()]).toEqual(["submissions/sub_1/verdict-detail.json"]);
    expect(JSON.parse(store.get("submissions/sub_1/verdict-detail.json")!)).toEqual(result);

    expect(submissionComplete).toHaveBeenCalledTimes(1);
    const updateArg = submissionComplete.mock.calls[0]![1] as {
      runtimeMs: number;
      memoryKb?: number;
      score: number;
      status: string;
      verdictSummary: { caseSummary: Record<string, number> };
      verdictDetailStorageKey: string;
    };
    expect(updateArg.runtimeMs).toBe(42);
    expect(updateArg.memoryKb).toBe(512);
    expect(updateArg.score).toBe(100);
    expect(updateArg.status).toBe("accepted");
    expect(updateArg.verdictDetailStorageKey).toBe("submissions/sub_1/verdict-detail.json");
    expect(updateArg.verdictSummary.caseSummary).toEqual({
      ac: 2,
      wa: 0,
      tle: 0,
      mle: 0,
      re: 0,
      other: 0,
    });
  });

  it("when S3 put fails, the DB update is NEVER called (no ghost AC with no detail)", async () => {
    const inMem = storageRef.client as unknown as { failOnPut: (n: number) => void };
    inMem.failOnPut(0);

    await expect(completeJudge("sub_2", makeResult())).rejects.toThrow(
      /Simulated storage failure/,
    );

    expect(submissionComplete).not.toHaveBeenCalled();
  });

  it("omits memoryKb from the DB update when the result didn't carry it", async () => {
    const result = makeResult({ verdict: "wrong_answer", score: 30 });
    submissionComplete.mockResolvedValue({
      id: "sub_3",
      contestId: null,
      examId: null,
      createdAt: new Date(),
      language: "python",
      problemId: "prob_3",
      sampleOnly: false,
      score: 30,
      status: "wrong_answer",
      userId: "usr_3",
    });

    await completeJudge("sub_3", result);

    const updateArg = submissionComplete.mock.calls[0]![1] as Record<string, unknown>;
    expect(updateArg).not.toHaveProperty("memoryKb");
  });

  it("records the advancedConfig audit snapshot when an advanced config is supplied", async () => {
    submissionComplete.mockResolvedValue({
      id: "sub_adv",
      contestId: null,
      examId: null,
      createdAt: new Date(),
      language: "python",
      problemId: "prob_adv",
      sampleOnly: false,
      score: 100,
      status: "accepted",
      userId: "usr_adv",
    });

    const config = {
      run: { imageRef: "registry.example.com/judge:v1", imageSource: "registry" as const },
      grade: { imageRef: "registry.example.com/judge:v1", imageSource: "registry" as const },
      network: { mode: "none" as const },
    };

    await completeJudge("sub_adv", makeResult({ verdict: "accepted", score: 100 }), config);

    const updateArg = submissionComplete.mock.calls[0]![1] as {
      advancedConfigSnapshot: unknown;
    };
    expect(updateArg.advancedConfigSnapshot).toEqual(config);
  });

  it("writes a null advancedConfig snapshot for non-advanced submissions", async () => {
    submissionComplete.mockResolvedValue({
      id: "sub_std",
      contestId: null,
      examId: null,
      createdAt: new Date(),
      language: "python",
      problemId: "prob_std",
      sampleOnly: false,
      score: 0,
      status: "wrong_answer",
      userId: "usr_std",
    });

    await completeJudge("sub_std", makeResult());

    const updateArg = submissionComplete.mock.calls[0]![1] as {
      advancedConfigSnapshot: unknown;
    };
    expect(updateArg.advancedConfigSnapshot).toBe(Prisma.JsonNull);
  });
});
