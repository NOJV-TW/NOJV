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

import { editorialDomain } from "@nojv/application";

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

  it("M3 fix: denies AC + contest missing (fail-closed)", async () => {
    submissionCount.mockResolvedValue(1);
    contestFindById.mockResolvedValue(null);
    await expect(
      canViewEditorials("usr_1", "prob_1", {
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
      canViewEditorials("usr_1", "prob_1", {
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

  it("M3 fix: denies AC + assignment missing (fail-closed)", async () => {
    submissionCount.mockResolvedValue(1);
    assessmentFindInfoById.mockRejectedValue(new Error("not found"));
    await expect(
      canViewEditorials("usr_1", "prob_1", {
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

  it("M3 fix: denies AC + exam missing (fail-closed)", async () => {
    submissionCount.mockResolvedValue(1);
    examFindById.mockResolvedValue(null);
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "exam",
        examId: "exm_missing",
        now: NOW,
      }),
    ).resolves.toBe(false);
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

  it("Phase 5.10: editorial author during active contest is blocked (gate checked first)", async () => {
    submissionCount.mockResolvedValue(0);
    editorialExistsForUserProblem.mockResolvedValue(true);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: FUTURE });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("Phase 5.10: editorial author during active assignment is blocked (gate checked first)", async () => {
    submissionCount.mockResolvedValue(0);
    editorialExistsForUserProblem.mockResolvedValue(true);
    assessmentFindInfoById.mockResolvedValue({ closesAt: FUTURE });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "assignment",
        assignmentId: "asn_1",
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  it("Phase 5.10: editorial author can view after contest ends even without AC", async () => {
    submissionCount.mockResolvedValue(0);
    editorialExistsForUserProblem.mockResolvedValue(true);
    contestFindById.mockResolvedValue({ id: "ctx_1", endsAt: PAST });
    await expect(
      canViewEditorials("usr_1", "prob_1", {
        kind: "contest",
        contestId: "ctx_1",
        now: NOW,
      }),
    ).resolves.toBe(true);
  });
});
