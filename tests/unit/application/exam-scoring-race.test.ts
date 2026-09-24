import { beforeEach, describe, expect, it, vi } from "vitest";
const { load, submissions, persist, overrides } = vi.hoisted(() => ({
  load: vi.fn(),
  submissions: vi.fn(),
  persist: vi.fn(),
  overrides: vi.fn(),
}));
vi.mock("@nojv/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nojv/db")>()),
  participationRepo: { findExamForScoring: load },
  submissionRepo: { findMany: submissions },
  scoreOverrideRepo: { findForExamUser: overrides },
  gradingRepo: { persistExamScore: persist },
  problemRepo: {
    findScoringInputsByIds: async (ids: string[]) =>
      ids.map((id) => ({ id, type: "full_source", testcaseSets: [{ weight: 200 }] })),
  },
  runTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
}));
import { updateExamScores } from "../../../packages/application/src/exam/scoring";
const endsAt = new Date("2026-01-02");
const participation = {
  id: "p",
  userId: "u",
  version: 0,
  exam: { id: "e", gradingRevision: 1, endsAt, problems: [{ problemId: "a", points: 100 }] },
};
beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(participation);
  submissions.mockResolvedValue([{ problemId: "a", score: 160 }]);
  persist.mockResolvedValue(true);
  overrides.mockResolvedValue([]);
});
describe("exam score convergence", () => {
  it("retries stale revisions and computes from freshly loaded allocation", async () => {
    persist.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    load.mockResolvedValueOnce(participation).mockResolvedValueOnce({
      ...participation,
      version: 1,
      exam: {
        ...participation.exam,
        gradingRevision: 2,
        problems: [{ problemId: "a", points: 50 }],
      },
    });
    await updateExamScores("e", "u");
    expect(persist).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ score: 40, version: 1, gradingRevision: 2 }),
    );
  });
  it("leaves exhausted work retryable", async () => {
    persist.mockResolvedValue(false);
    await expect(updateExamScores("e", "u")).rejects.toThrow(/Retry/);
    expect(persist).toHaveBeenCalledTimes(3);
  });
  it("handles missing participation and raw overrides", async () => {
    load.mockResolvedValueOnce(null);
    await updateExamScores("e", "u");
    expect(persist).not.toHaveBeenCalled();
    overrides.mockResolvedValue([{ userId: "u", problemId: "a", overrideScore: 100 }]);
    await updateExamScores("e", "u");
    expect(persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ score: 50 }),
    );
  });
});
