import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  submissionCount,
  editorialExistsForUserProblem,
  contestFindById,
  assessmentFindInfoById,
  examFindById,
} = vi.hoisted(() => ({
  submissionCount: vi.fn(),
  editorialExistsForUserProblem: vi.fn(),
  contestFindById: vi.fn(),
  assessmentFindInfoById: vi.fn(),
  examFindById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { count: submissionCount },
  editorialRepo: { existsForUserProblem: editorialExistsForUserProblem },
  contestRepo: { findById: contestFindById },
  assessmentRepo: { findInfoById: assessmentFindInfoById },
  examRepo: { findById: examFindById },
}));

import { editorialDomain } from "@nojv/domain";

const { canViewEditorials } = editorialDomain;

const NOW = new Date("2026-05-28T12:00:00.000Z");
const PAST = new Date("2026-05-28T11:00:00.000Z");
const FUTURE = new Date("2026-05-28T13:00:00.000Z");

beforeEach(() => {
  submissionCount.mockReset();
  editorialExistsForUserProblem.mockReset();
  contestFindById.mockReset();
  assessmentFindInfoById.mockReset();
  examFindById.mockReset();
  // By default, the user is NOT an editorial author. Each test that needs
  // the grandfather rule sets this to true explicitly.
  editorialExistsForUserProblem.mockResolvedValue(false);
});

describe("canViewEditorials — context gate", () => {
  it("allows AC + practice (no context arg → default practice)", async () => {
    submissionCount.mockResolvedValue(1);
    await expect(canViewEditorials("usr_1", "prob_1")).resolves.toBe(true);
  });

  it("allows AC + practice (explicit practice context)", async () => {
    submissionCount.mockResolvedValue(1);
    await expect(canViewEditorials("usr_1", "prob_1", { kind: "practice" })).resolves.toBe(
      true,
    );
  });

  it("denies AC + contest still in progress (now < endsAt)", async () => {
    submissionCount.mockResolvedValue(1);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: FUTURE });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
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
      canViewEditorials("usr_1", "prob_1", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("allows AC + contest missing (defensive — don't lock out)", async () => {
    submissionCount.mockResolvedValue(1);
    contestFindById.mockResolvedValue(null);
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "contest",
        contestId: "ctx_missing",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("denies AC + assignment before closesAt", async () => {
    submissionCount.mockResolvedValue(1);
    assessmentFindInfoById.mockResolvedValue({ closesAt: FUTURE });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
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
      canViewEditorials("usr_1", "prob_1", {
        kind: "assignment",
        assignmentId: "asn_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("allows AC + assignment missing (defensive)", async () => {
    submissionCount.mockResolvedValue(1);
    // findInfoById throws on a missing row; canViewEditorials must
    // swallow that and grant access rather than lock the student out.
    assessmentFindInfoById.mockRejectedValue(new Error("not found"));
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "assignment",
        assignmentId: "asn_missing",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("denies AC + exam in progress", async () => {
    submissionCount.mockResolvedValue(1);
    examFindById.mockResolvedValue({ id: "exm_1", endsAt: FUTURE });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
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
      canViewEditorials("usr_1", "prob_1", {
        kind: "exam",
        examId: "exm_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("allows AC + exam missing (defensive)", async () => {
    submissionCount.mockResolvedValue(1);
    examFindById.mockResolvedValue(null);
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "exam",
        examId: "exm_missing",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("denies non-AC user regardless of context (practice)", async () => {
    submissionCount.mockResolvedValue(0);
    await expect(canViewEditorials("usr_1", "prob_1", { kind: "practice" })).resolves.toBe(
      false,
    );
  });

  it("denies non-AC user regardless of context (contest after end)", async () => {
    submissionCount.mockResolvedValue(0);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: PAST });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("allows editorial author + contest in progress (grandfather rule)", async () => {
    // Author has no AC (e.g. rejudge overturned it) — should still see
    // editorials regardless of the active context gate.
    submissionCount.mockResolvedValue(0);
    editorialExistsForUserProblem.mockResolvedValue(true);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: FUTURE });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("allows editorial author + assignment before closesAt (grandfather rule)", async () => {
    submissionCount.mockResolvedValue(0);
    editorialExistsForUserProblem.mockResolvedValue(true);
    assessmentFindInfoById.mockResolvedValue({ closesAt: FUTURE });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "assignment",
        assignmentId: "asn_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });
});
