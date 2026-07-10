import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  submissionCount,
  postExistsForUserProblem,
  contestFindById,
  assessmentFindInfoById,
  examFindById,
} = vi.hoisted(() => ({
  submissionCount: vi.fn(),
  postExistsForUserProblem: vi.fn(),
  contestFindById: vi.fn(),
  assessmentFindInfoById: vi.fn(),
  examFindById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { count: submissionCount },
  postRepo: { existsForUserProblem: postExistsForUserProblem },
  contestRepo: { findById: contestFindById },
  assessmentRepo: { findInfoById: assessmentFindInfoById },
  examRepo: { findById: examFindById },
}));

import { postDomain } from "@nojv/application";

const { canViewPosts } = postDomain;

const NOW = new Date("2026-05-28T12:00:00.000Z");
const PAST = new Date("2026-05-28T11:00:00.000Z");
const FUTURE = new Date("2026-05-28T13:00:00.000Z");

beforeEach(() => {
  submissionCount.mockReset();
  postExistsForUserProblem.mockReset();
  contestFindById.mockReset();
  assessmentFindInfoById.mockReset();
  examFindById.mockReset();
  postExistsForUserProblem.mockResolvedValue(false);
});

describe("canViewPosts — context gate (editorial)", () => {
  it("allows AC + practice (no context arg → default practice)", async () => {
    submissionCount.mockResolvedValue(1);
    await expect(canViewPosts("usr_1", "prob_1", "editorial")).resolves.toBe(true);
  });

  it("allows AC + practice (explicit practice context)", async () => {
    submissionCount.mockResolvedValue(1);
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", { kind: "practice" }),
    ).resolves.toBe(true);
  });

  it("denies AC + contest still in progress (now < endsAt)", async () => {
    submissionCount.mockResolvedValue(1);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: FUTURE });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("allows AC + contest that has ended (now >= endsAt)", async () => {
    submissionCount.mockResolvedValue(1);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: PAST });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("M3 fix: denies AC + contest missing (fail-closed)", async () => {
    submissionCount.mockResolvedValue(1);
    contestFindById.mockResolvedValue(null);
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "contest",
        contestId: "ctx_missing",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("M3 fix: denies AC + contest lookup throwing (fail-closed)", async () => {
    submissionCount.mockResolvedValue(1);
    contestFindById.mockRejectedValue(new Error("connection lost"));
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("denies AC + assignment before closesAt", async () => {
    submissionCount.mockResolvedValue(1);
    assessmentFindInfoById.mockResolvedValue({ closesAt: FUTURE });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "assignment",
        assignmentId: "asn_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("allows AC + assignment after closesAt", async () => {
    submissionCount.mockResolvedValue(1);
    assessmentFindInfoById.mockResolvedValue({ closesAt: PAST });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "assignment",
        assignmentId: "asn_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("M3 fix: denies AC + assignment missing (fail-closed)", async () => {
    submissionCount.mockResolvedValue(1);
    assessmentFindInfoById.mockRejectedValue(new Error("not found"));
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "assignment",
        assignmentId: "asn_missing",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("denies AC + exam in progress", async () => {
    submissionCount.mockResolvedValue(1);
    examFindById.mockResolvedValue({ id: "exm_1", endsAt: FUTURE });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "exam",
        examId: "exm_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("allows AC + exam after endsAt", async () => {
    submissionCount.mockResolvedValue(1);
    examFindById.mockResolvedValue({ id: "exm_1", endsAt: PAST });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "exam",
        examId: "exm_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("M3 fix: denies AC + exam missing (fail-closed)", async () => {
    submissionCount.mockResolvedValue(1);
    examFindById.mockResolvedValue(null);
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "exam",
        examId: "exm_missing",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("denies non-AC user regardless of context (practice)", async () => {
    submissionCount.mockResolvedValue(0);
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", { kind: "practice" }),
    ).resolves.toBe(false);
  });

  it("denies non-AC user regardless of context (contest after end)", async () => {
    submissionCount.mockResolvedValue(0);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: PAST });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("Phase 5.10: editorial author during active contest is blocked (gate checked first)", async () => {
    submissionCount.mockResolvedValue(0);
    postExistsForUserProblem.mockResolvedValue(true);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: FUTURE });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("Phase 5.10: editorial author during active assignment is blocked (gate checked first)", async () => {
    submissionCount.mockResolvedValue(0);
    postExistsForUserProblem.mockResolvedValue(true);
    assessmentFindInfoById.mockResolvedValue({ closesAt: FUTURE });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "assignment",
        assignmentId: "asn_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("Phase 5.10: editorial author can view after contest ends even without AC", async () => {
    submissionCount.mockResolvedValue(0);
    postExistsForUserProblem.mockResolvedValue(true);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: PAST });
    await expect(
      canViewPosts("usr_1", "prob_1", "editorial", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });
});

describe("canViewPosts — context gate (discussion)", () => {
  it("denies a non-AC user during an active contest", async () => {
    submissionCount.mockResolvedValue(0);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: FUTURE });
    await expect(
      canViewPosts("usr_1", "prob_1", "discussion", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("denies an AC user during an active exam", async () => {
    submissionCount.mockResolvedValue(1);
    examFindById.mockResolvedValue({ id: "exm_1", endsAt: FUTURE });
    await expect(
      canViewPosts("usr_1", "prob_1", "discussion", {
        kind: "exam",
        examId: "exm_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("allows a non-AC user once the contest has ended", async () => {
    submissionCount.mockResolvedValue(0);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: PAST });
    await expect(
      canViewPosts("usr_1", "prob_1", "discussion", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("allows a non-AC user once the assignment has closed", async () => {
    submissionCount.mockResolvedValue(0);
    assessmentFindInfoById.mockResolvedValue({ closesAt: PAST });
    await expect(
      canViewPosts("usr_1", "prob_1", "discussion", {
        kind: "assignment",
        assignmentId: "asn_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });
});
