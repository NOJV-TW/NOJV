import { describe, expect, it } from "vitest";

import {
  createTestContest,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

import { contestDomain } from "@nojv/domain";

const { listPublicContests, getContestDetail, getContestWorkspaceData, getScoreboard } =
  contestDomain;
import { NotFoundError } from "$lib/server/auth";

describe("contest queries (real DB)", () => {
  // --- listPublicContests ---

  describe("listPublicContests", () => {
    it("returns published contests", async () => {
      await createTestContest({ visibility: "published", title: "Public Contest" });
      await createTestContest({ visibility: "draft", title: "Draft Contest" });

      const contests = await listPublicContests();
      expect(contests).toHaveLength(1);
      expect(contests[0]!.title).toBe("Public Contest");
    });

    it("returns empty array when no published contests exist", async () => {
      const contests = await listPublicContests();
      expect(contests).toEqual([]);
    });

    it("includes correct participant and problem counts", async () => {
      const contest = await createTestContest({ visibility: "published" });
      const problem = await createTestProblem();

      await testPrisma.contestProblem.create({
        data: {
          contestId: contest.id,
          problemId: problem.id,
          ordinal: 1,
          points: 100,
        },
      });

      const user = await createTestUser();
      await testPrisma.contestParticipation.create({
        data: {
          contestId: contest.id,
          userId: user.id,
          status: "active",
          startedAt: new Date(),
        },
      });

      const contests = await listPublicContests();
      expect(contests).toHaveLength(1);
      expect(contests[0]!.problemCount).toBe(1);
      expect(contests[0]!.participantCount).toBe(1);
    });
  });

  // --- getContestDetail ---

  describe("getContestDetail", () => {
    it("returns contest detail with linked problems", async () => {
      const contest = await createTestContest({
        id: "detail-test",
        visibility: "published",
        title: "Detail Contest",
      });
      const problem = await createTestProblem();

      await testPrisma.contestProblem.create({
        data: {
          contestId: contest.id,
          problemId: problem.id,
          ordinal: 1,
          points: 200,
        },
      });

      const detail = await getContestDetail(contest.id, { userId: null, now: new Date() });
      expect(detail).not.toBeNull();
      expect(detail!.title).toBe("Detail Contest");
      expect(detail!.problems).toHaveLength(1);
      expect(detail!.problems![0]!.points).toBe(200);
      expect(detail!.problems![0]!.id).toBe(problem.id);
    });

    it("throws NotFoundError for nonexistent contestId", async () => {
      await expect(
        getContestDetail("nonexistent", { userId: null, now: new Date() }),
      ).rejects.toThrow("Contest not found: nonexistent");
    });

    it("throws NotFoundError for draft contest", async () => {
      const contest = await createTestContest({
        id: "draft-contest",
        visibility: "draft",
      });
      await expect(
        getContestDetail(contest.id, { userId: null, now: new Date() }),
      ).rejects.toThrow(`Contest not found: ${contest.id}`);
    });

    it("returns problems ordered by ordinal", async () => {
      const contest = await createTestContest({
        id: "ordered-problems",
        visibility: "published",
      });
      const p1 = await createTestProblem({ title: "Problem B" });
      const p2 = await createTestProblem({ title: "Problem A" });

      await testPrisma.contestProblem.create({
        data: { contestId: contest.id, problemId: p1.id, ordinal: 2, points: 100 },
      });
      await testPrisma.contestProblem.create({
        data: { contestId: contest.id, problemId: p2.id, ordinal: 1, points: 100 },
      });

      const detail = await getContestDetail(contest.id, {
        userId: null,
        now: new Date(),
      });
      expect(detail!.problems![0]!.title).toBe("Problem A");
      expect(detail!.problems![1]!.title).toBe("Problem B");
    });
  });

  // --- getContestWorkspaceData ---

  describe("getContestWorkspaceData", () => {
    it("returns null participation when user has not joined", async () => {
      const contest = await createTestContest({
        id: "workspace-test",
        visibility: "published",
      });
      const user = await createTestUser();

      const data = await getContestWorkspaceData(contest.id, user.id, {
        now: new Date(),
      });
      expect(data).not.toBeNull();
      expect(data!.participation).toBeNull();
    });

    it("returns participation data when user has joined", async () => {
      const contest = await createTestContest({
        id: "joined-contest",
        visibility: "published",
      });
      const user = await createTestUser();

      await testPrisma.contestParticipation.create({
        data: {
          contestId: contest.id,
          userId: user.id,
          status: "active",
          startedAt: new Date(),
        },
      });

      const data = await getContestWorkspaceData(contest.id, user.id, {
        now: new Date(),
      });
      expect(data).not.toBeNull();
      expect(data!.participation).not.toBeNull();
      expect(data!.participation!.status).toBe("active");
    });
  });

  // --- getScoreboard ---

  describe("getScoreboard", () => {
    it("throws NotFoundError for nonexistent contest", async () => {
      await expect(getScoreboard("nonexistent")).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError for draft contest", async () => {
      const contest = await createTestContest({
        id: "draft-sb",
        visibility: "draft",
      });
      await expect(getScoreboard(contest.id)).rejects.toThrow(NotFoundError);
    });

    it("returns empty entries when no participants", async () => {
      const contest = await createTestContest({
        id: "empty-sb",
        visibility: "published",
      });
      const problem = await createTestProblem();
      await testPrisma.contestProblem.create({
        data: { contestId: contest.id, problemId: problem.id, ordinal: 1, points: 100 },
      });

      const sb = await getScoreboard(contest.id);
      expect(sb.entries).toEqual([]);
      expect(sb.problems).toHaveLength(1);
    });

    it("returns scoreboard with correct problem_count scoring", async () => {
      const contest = await createTestContest({
        id: "problem-count-sb",
        visibility: "published",
        scoringMode: "problem_count",
        startsAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-12-31T23:59:59Z"),
      });

      const problem = await createTestProblem();
      await testPrisma.contestProblem.create({
        data: { contestId: contest.id, problemId: problem.id, ordinal: 1, points: 100 },
      });

      const user = await createTestUser();
      const participation = await testPrisma.contestParticipation.create({
        data: {
          contestId: contest.id,
          userId: user.id,
          status: "active",
          startedAt: new Date("2026-01-01T00:00:00Z"),
        },
      });

      // Create an accepted submission. Sources live in object storage but the
      // scoreboard test doesn't read them — just stamp a prefix.
      const subId = "sub_problem_count_sb_1";
      await testPrisma.submission.create({
        data: {
          id: subId,
          contestId: contest.id,
          contestParticipationId: participation.id,
          language: "python",
          problemId: problem.id,
          sampleOnly: false,
          sourceStoragePrefix: `submissions/${subId}/sources/`,
          status: "accepted",
          userId: user.id,
          createdAt: new Date("2026-01-01T01:00:00Z"),
          score: 100,
        },
      });

      const sb = await getScoreboard(contest.id);
      expect(sb.entries).toHaveLength(1);
      expect(sb.entries[0]!.totalScore).toBe(100);
      expect(sb.entries[0]!.rank).toBe(1);
      expect(sb.scoringMode).toBe("problem_count");
    });

    it("returns hidden scoreboard with no entries for non-privileged users", async () => {
      const contest = await createTestContest({
        id: "hidden-sb",
        visibility: "published",
        scoreboardMode: "hidden",
      });

      const sb = await getScoreboard(contest.id, { isPrivileged: false });
      expect(sb.entries).toEqual([]);
      expect(sb.scoreboardMode).toBe("hidden");
    });
  });
});
