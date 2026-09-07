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
describe("exam scoring cutoff", () => {
  it("only loads non-sample submissions created by the exam deadline", async () => {
    await updateExamScores("e", "u");
    expect(submissions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { examId: "e", userId: "u", sampleOnly: false, createdAt: { lt: endsAt } },
      }),
    );
  });
});
