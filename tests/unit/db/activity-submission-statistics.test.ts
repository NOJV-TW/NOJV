import { beforeEach, expect, it, vi } from "vitest";

const groupBy = vi.hoisted(() => vi.fn());
vi.mock("../../../packages/db/src/client", () => ({
  prisma: { submission: { groupBy } },
}));
import { submissionStatistics } from "../../../packages/db/src/repositories/submission/statistics";

const activities = [
  { id: "a1", deadline: new Date("2026-09-24"), problems: [{ problemId: "p1" }] },
  { id: "a2", deadline: new Date("2026-09-25"), problems: [{ problemId: "p2" }] },
];
beforeEach(() => {
  groupBy.mockReset().mockResolvedValue([]);
});

it("keeps each exam's exclusive deadline and problem scope in one query", async () => {
  await submissionStatistics.groupByActivity("exam", activities, "u1");
  expect(groupBy).toHaveBeenCalledExactlyOnceWith({
    by: ["assessmentId", "examId", "userId", "problemId"],
    where: {
      userId: "u1",
      sampleOnly: false,
      isReferenceSolution: false,
      OR: [
        { examId: "a1", createdAt: { lt: activities[0]!.deadline }, problemId: { in: ["p1"] } },
        { examId: "a2", createdAt: { lt: activities[1]!.deadline }, problemId: { in: ["p2"] } },
      ],
    },
    _max: { score: true },
  });
});

it("does not apply the exam deadline or a user restriction to assignment class statistics", async () => {
  await submissionStatistics.groupByActivity("assignment", activities);
  expect(groupBy.mock.calls[0]![0].where).toEqual({
    sampleOnly: false,
    isReferenceSolution: false,
    OR: [
      { assessmentId: "a1", problemId: { in: ["p1"] } },
      { assessmentId: "a2", problemId: { in: ["p2"] } },
    ],
  });
});

it("does not query submissions for an empty activity list", async () => {
  expect(await submissionStatistics.groupByActivity("exam", [])).toEqual([]);
  expect(groupBy).not.toHaveBeenCalled();
});
