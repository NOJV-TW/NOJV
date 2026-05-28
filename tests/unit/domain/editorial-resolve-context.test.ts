import { beforeEach, describe, expect, it, vi } from "vitest";

const { findActiveContests, findActiveAssessments, findActiveExams } = vi.hoisted(() => ({
  findActiveContests: vi.fn(),
  findActiveAssessments: vi.fn(),
  findActiveExams: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  // Mocks only what queries.ts imports — repos that aren't used by the
  // resolver still need to be present so the module-level import succeeds.
  submissionRepo: { count: vi.fn() },
  editorialRepo: { existsForUserProblem: vi.fn() },
  contestRepo: { findById: vi.fn() },
  assessmentRepo: { findInfoById: vi.fn() },
  examRepo: { findById: vi.fn() },
  contestProblemRepo: { findActiveContestsForUser: findActiveContests },
  assessmentProblemRepo: { findActiveAssessmentsForUser: findActiveAssessments },
  examProblemRepo: { findActiveExamsForUser: findActiveExams },
}));

import { editorialDomain } from "@nojv/domain";

const { resolveActiveContextForUser } = editorialDomain;

const NOW = new Date("2026-05-28T12:00:00.000Z");

beforeEach(() => {
  findActiveContests.mockReset();
  findActiveAssessments.mockReset();
  findActiveExams.mockReset();
  // Default to "no active event" — each test overrides as needed.
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
    // Two active contests: the later-ending one keeps the gate closed
    // longest, so it's the strictest pick.
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
    // Each repo helper is responsible for filtering by enrollment — the
    // resolver trusts an empty array means "user not in any active event"
    // and falls back to practice context.
    findActiveContests.mockResolvedValue([]);
    findActiveAssessments.mockResolvedValue([]);
    findActiveExams.mockResolvedValue([]);
    await expect(resolveActiveContextForUser("usr_outsider", "prob_1", NOW)).resolves.toEqual({
      kind: "practice",
    });
  });

  it("skips active events whose problem list does NOT include this problem", async () => {
    // The repo helpers filter by problemId server-side, so when the
    // problem isn't in any active event the resolver sees empty arrays
    // and degrades to practice — even if the user is in other active
    // events for unrelated problems.
    findActiveContests.mockResolvedValue([]);
    await expect(resolveActiveContextForUser("usr_1", "prob_unrelated", NOW)).resolves.toEqual({
      kind: "practice",
    });
  });

  it("H1 fix: course-enrolled student with no participation yet is still gated by live contest", async () => {
    // ContestParticipation is created lazily on first submission. A
    // student who has past-AC'd the problem and faces a live contest
    // that reuses it must still resolve to contest context — not
    // practice — even though no participation row exists yet. The
    // repo helper (mocked here) is expected to surface the contest
    // based on eligibility (published + live), not participation.
    const endsAt = new Date("2026-05-28T14:00:00.000Z");
    findActiveContests.mockResolvedValue([{ contest: { id: "ctx_live", endsAt } }]);
    await expect(resolveActiveContextForUser("usr_no_part", "prob_1", NOW)).resolves.toEqual({
      kind: "contest",
      contestId: "ctx_live",
      now: NOW,
    });
  });

  it("H1 fix: course-enrolled student with no participation yet is still gated by live exam", async () => {
    // Same pattern for exams: ExamParticipation is created lazily on
    // first submission. The repo helper keys eligibility on active
    // course membership (exams are always course-embedded), so an
    // enrolled-but-unsubmitted student gets the exam context, not
    // a practice downgrade.
    const endsAt = new Date("2026-05-28T14:00:00.000Z");
    findActiveExams.mockResolvedValue([{ exam: { id: "exm_live", endsAt } }]);
    await expect(resolveActiveContextForUser("usr_no_part", "prob_1", NOW)).resolves.toEqual({
      kind: "exam",
      examId: "exm_live",
      now: NOW,
    });
  });

  it("picks the strictest gate across heterogeneous event types", async () => {
    // assignment ends latest → must win over contest + exam.
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
