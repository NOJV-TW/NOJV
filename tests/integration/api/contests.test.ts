import { describe, expect, it } from "vitest";

import {
  createTestContest,
  createTestProblem,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import {
  listPublicContests,
  getContestDetail,
  getContestWorkspaceData
} from "$lib/server/contest/queries";
import { getScoreboard } from "$lib/server/contest/scoreboard";
import { NotFoundError } from "$lib/server/auth";

describe("contest queries (real DB)", () => {
  // --- listPublicContests ---

  describe("listPublicContests", () => {
    it("returns published contests without a courseId", async () => {
      await createTestContest({ visibility: "published", title: "Public Contest" });
      await createTestContest({ visibility: "draft", title: "Draft Contest" });

      const contests = await listPublicContests();
      expect(contests).toHaveLength(1);
      expect(contests[0]!.title).toBe("Public Contest");
    });

    it("excludes contests linked to a course", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await testPrisma.course.create({
        data: {
          id: "course-for-contest",
          slug: "course-for-contest",
          title: "Test Course",
          description: "Test",
          locale: "en",
          visibility: "listed",
          ownerId: teacher.id
        }
      });

      await createTestContest({ courseId: course.id, visibility: "published" });
      await createTestContest({ visibility: "published", title: "Independent" });

      const contests = await listPublicContests();
      expect(contests).toHaveLength(1);
      expect(contests[0]!.title).toBe("Independent");
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
          points: 100
        }
      });

      const user = await createTestUser();
      await testPrisma.contestParticipation.create({
        data: {
          contestId: contest.id,
          userId: user.id,
          status: "active",
          startedAt: new Date()
        }
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
        slug: "detail-test",
        visibility: "published",
        title: "Detail Contest"
      });
      const problem = await createTestProblem();

      await testPrisma.contestProblem.create({
        data: {
          contestId: contest.id,
          problemId: problem.id,
          ordinal: 1,
          points: 200
        }
      });

      const detail = await getContestDetail("detail-test");
      expect(detail).not.toBeNull();
      expect(detail!.title).toBe("Detail Contest");
      expect(detail!.problems).toHaveLength(1);
      expect(detail!.problems[0]!.points).toBe(200);
      expect(detail!.problems[0]!.slug).toBe(problem.slug);
    });

    it("returns null for nonexistent slug", async () => {
      const detail = await getContestDetail("nonexistent");
      expect(detail).toBeNull();
    });

    it("returns null for draft contest", async () => {
      await createTestContest({ slug: "draft-contest", visibility: "draft" });
      const detail = await getContestDetail("draft-contest");
      expect(detail).toBeNull();
    });

    it("returns problems ordered by ordinal", async () => {
      const contest = await createTestContest({
        slug: "ordered-problems",
        visibility: "published"
      });
      const p1 = await createTestProblem({ defaultTitle: "Problem B" });
      const p2 = await createTestProblem({ defaultTitle: "Problem A" });

      await testPrisma.contestProblem.create({
        data: { contestId: contest.id, problemId: p1.id, ordinal: 2, points: 100 }
      });
      await testPrisma.contestProblem.create({
        data: { contestId: contest.id, problemId: p2.id, ordinal: 1, points: 100 }
      });

      const detail = await getContestDetail("ordered-problems");
      expect(detail!.problems[0]!.title).toBe("Problem A");
      expect(detail!.problems[1]!.title).toBe("Problem B");
    });
  });

  // --- getContestWorkspaceData ---

  describe("getContestWorkspaceData", () => {
    it("returns null participation when user has not joined", async () => {
      const contest = await createTestContest({
        slug: "workspace-test",
        visibility: "published"
      });
      const user = await createTestUser();

      const data = await getContestWorkspaceData("workspace-test", user.id);
      expect(data).not.toBeNull();
      expect(data!.participation).toBeNull();
    });

    it("returns participation data when user has joined", async () => {
      const contest = await createTestContest({
        slug: "joined-contest",
        visibility: "published"
      });
      const user = await createTestUser();

      await testPrisma.contestParticipation.create({
        data: {
          contestId: contest.id,
          userId: user.id,
          status: "active",
          startedAt: new Date()
        }
      });

      const data = await getContestWorkspaceData("joined-contest", user.id);
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
      await createTestContest({ slug: "draft-sb", visibility: "draft" });
      await expect(getScoreboard("draft-sb")).rejects.toThrow(NotFoundError);
    });

    it("returns empty entries when no participants", async () => {
      const contest = await createTestContest({
        slug: "empty-sb",
        visibility: "published"
      });
      const problem = await createTestProblem();
      await testPrisma.contestProblem.create({
        data: { contestId: contest.id, problemId: problem.id, ordinal: 1, points: 100 }
      });

      const sb = await getScoreboard("empty-sb");
      expect(sb.entries).toEqual([]);
      expect(sb.problems).toHaveLength(1);
    });

    it("returns scoreboard with correct ICPC scoring", async () => {
      const contest = await createTestContest({
        slug: "icpc-sb",
        visibility: "published",
        scoringMode: "icpc",
        startsAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-12-31T23:59:59Z")
      });

      const problem = await createTestProblem();
      await testPrisma.contestProblem.create({
        data: { contestId: contest.id, problemId: problem.id, ordinal: 1, points: 100 }
      });

      const user = await createTestUser();
      const participation = await testPrisma.contestParticipation.create({
        data: {
          contestId: contest.id,
          userId: user.id,
          status: "active",
          startedAt: new Date("2026-01-01T00:00:00Z")
        }
      });

      // Create an accepted submission
      await testPrisma.submission.create({
        data: {
          contestId: contest.id,
          contestParticipationId: participation.id,
          language: "python",
          mode: "contest",
          problemId: problem.id,
          sampleOnly: false,
          sourceCode: "print(1)",
          status: "accepted",
          userId: user.id,
          createdAt: new Date("2026-01-01T01:00:00Z"),
          score: 100
        }
      });

      const sb = await getScoreboard("icpc-sb");
      expect(sb.entries).toHaveLength(1);
      expect(sb.entries[0]!.totalScore).toBe(100);
      expect(sb.entries[0]!.rank).toBe(1);
      expect(sb.scoringMode).toBe("icpc");
    });

    it("returns hidden scoreboard with no entries for non-privileged users", async () => {
      await createTestContest({
        slug: "hidden-sb",
        visibility: "published",
        scoreboardMode: "hidden"
      });

      const sb = await getScoreboard("hidden-sb", { isPrivileged: false });
      expect(sb.entries).toEqual([]);
      expect(sb.scoreboardMode).toBe("hidden");
    });
  });
});
