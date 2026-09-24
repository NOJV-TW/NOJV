import { beforeEach, describe, expect, it, vi } from "vitest";

const { findActiveContests, findActiveAssessments, findActiveExams } = vi.hoisted(() => ({
  findActiveContests: vi.fn(),
  findActiveAssessments: vi.fn(),
  findActiveExams: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { count: vi.fn() },
  postRepo: { existsForUserProblem: vi.fn() },
  contestRepo: { findById: vi.fn() },
  assessmentRepo: { findInfoById: vi.fn() },
  examRepo: { findById: vi.fn() },
  contestProblemRepo: { findActiveContestsForUser: findActiveContests },
  assessmentProblemRepo: { findActiveAssessmentsForUser: findActiveAssessments },
  examProblemRepo: { findActiveExamsForUser: findActiveExams },
}));

import { postDomain } from "@nojv/application";

const { resolveActiveContextForUser } = postDomain;

const NOW = new Date("2026-05-28T12:00:00.000Z");

beforeEach(() => {
  findActiveContests.mockReset();
  findActiveAssessments.mockReset();
  findActiveExams.mockReset();
  findActiveContests.mockResolvedValue([]);
  findActiveAssessments.mockResolvedValue([]);
  findActiveExams.mockResolvedValue([]);
});

describe("resolveActiveContextForUser", () => {
  it("returns practice when no active event contains the problem", async () => {
    await expect(resolveActiveContextForUser("usr_1", "prob_1", NOW)).resolves.toEqual({
      kind: "practice",
    });
  });

  it("returns the contest context when a single active contest includes the problem", async () => {
    const endsAt = new Date("2026-05-28T14:00:00.000Z");
    findActiveContests.mockResolvedValue([{ contest: { id: "ctx_1", endsAt } }]);
    await expect(resolveActiveContextForUser("usr_1", "prob_1", NOW)).resolves.toEqual({
      kind: "contest",
      contestId: "ctx_1",
      now: NOW,
    });
  });

  it("picks the latest-ending (strictest) candidate when two contests overlap", async () => {
    const earlier = new Date("2026-05-28T13:00:00.000Z");
    const later = new Date("2026-05-28T15:00:00.000Z");
    findActiveContests.mockResolvedValue([
      { contest: { id: "ctx_early", endsAt: earlier } },
      { contest: { id: "ctx_late", endsAt: later } },
    ]);
    await expect(resolveActiveContextForUser("usr_1", "prob_1", NOW)).resolves.toEqual({
      kind: "contest",
      contestId: "ctx_late",
      now: NOW,
    });
  });

  it("skips events where the user is not enrolled / not participating", async () => {
    findActiveContests.mockResolvedValue([]);
    findActiveAssessments.mockResolvedValue([]);
    findActiveExams.mockResolvedValue([]);
    await expect(resolveActiveContextForUser("usr_outsider", "prob_1", NOW)).resolves.toEqual({
      kind: "practice",
    });
  });

  it("skips active events whose problem list does NOT include this problem", async () => {
    findActiveContests.mockResolvedValue([]);
    await expect(resolveActiveContextForUser("usr_1", "prob_unrelated", NOW)).resolves.toEqual({
      kind: "practice",
    });
  });

  it("H1 fix: course-enrolled student with no participation yet is still gated by live contest", async () => {
    const endsAt = new Date("2026-05-28T14:00:00.000Z");
    findActiveContests.mockResolvedValue([{ contest: { id: "ctx_live", endsAt } }]);
    await expect(resolveActiveContextForUser("usr_no_part", "prob_1", NOW)).resolves.toEqual({
      kind: "contest",
      contestId: "ctx_live",
      now: NOW,
    });
  });

  it("H1 fix: course-enrolled student with no participation yet is still gated by live exam", async () => {
    const endsAt = new Date("2026-05-28T14:00:00.000Z");
    findActiveExams.mockResolvedValue([{ exam: { id: "exm_live", endsAt } }]);
    await expect(resolveActiveContextForUser("usr_no_part", "prob_1", NOW)).resolves.toEqual({
      kind: "exam",
      examId: "exm_live",
      now: NOW,
    });
  });

  it("picks the strictest gate across heterogeneous event types", async () => {
    const contestEnds = new Date("2026-05-28T13:30:00.000Z");
    const assignmentCloses = new Date("2026-05-28T16:00:00.000Z");
    const examEnds = new Date("2026-05-28T15:00:00.000Z");
    findActiveContests.mockResolvedValue([{ contest: { id: "ctx_1", endsAt: contestEnds } }]);
    findActiveAssessments.mockResolvedValue([
      { assessment: { id: "asn_1", closesAt: assignmentCloses } },
    ]);
    findActiveExams.mockResolvedValue([{ exam: { id: "exm_1", endsAt: examEnds } }]);
    await expect(resolveActiveContextForUser("usr_1", "prob_1", NOW)).resolves.toEqual({
      kind: "assignment",
      assignmentId: "asn_1",
      now: NOW,
    });
  });
});
