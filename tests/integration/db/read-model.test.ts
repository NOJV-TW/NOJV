import { describe, expect, it } from "vitest";

import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import {
  listProblemCards,
  getProblemPageData,
  listSolvedProblemSlugs
} from "$lib/server/problem/queries";
import { getCoursePageData, listCourseCards } from "$lib/server/course/queries";

describe("read model (real DB)", () => {

  // --- listProblemCards ---

  describe("listProblemCards", () => {
    it("returns public problems only", async () => {
      await createTestProblem({ visibility: "public", defaultTitle: "Public P" });
      await createTestProblem({ visibility: "private", defaultTitle: "Private P" });

      const cards = await listProblemCards();
      expect(cards).toHaveLength(1);
      expect(cards[0]!.title).toBe("Public P");
    });

    it("returns empty array when no problems exist", async () => {
      const cards = await listProblemCards();
      expect(cards).toEqual([]);
    });

    it("includes correct totalSubmissions count", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({
        authorId: user.id,
        visibility: "public"
      });

      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        mode: "practice"
      });
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "wrong_answer",
        mode: "practice"
      });

      const cards = await listProblemCards();
      expect(cards).toHaveLength(1);
      expect(cards[0]!.totalSubmissions).toBe(2);
    });

    it("calculates acceptance rate correctly", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({
        authorId: user.id,
        visibility: "public"
      });

      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        mode: "practice"
      });
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "wrong_answer",
        mode: "practice"
      });

      const cards = await listProblemCards();
      expect(cards[0]!.acceptanceRate).toBe(0.5);
    });

    it("returns 0 acceptance rate when no submissions", async () => {
      await createTestProblem({ visibility: "public" });

      const cards = await listProblemCards();
      expect(cards[0]!.acceptanceRate).toBe(0);
    });

    it("includes slug, difficulty, and tags", async () => {
      await createTestProblem({
        slug: "two-sum",
        difficulty: "hard",
        visibility: "public",
        tags: ["array", "hash-table"]
      });

      const cards = await listProblemCards();
      expect(cards).toHaveLength(1);
      expect(cards[0]!.slug).toBe("two-sum");
      expect(cards[0]!.difficulty).toBe("hard");
      expect(cards[0]!.tags).toEqual(["array", "hash-table"]);
    });
  });

  // --- getProblemPageData ---

  describe("getProblemPageData", () => {
    it("returns null for nonexistent slug", async () => {
      const result = await getProblemPageData("nonexistent");
      expect(result).toBeNull();
    });

    it("returns full problem detail with statement and samples", async () => {
      const author = await createTestUser({ platformRole: "teacher", username: "prof" });
      await createTestProblem({
        slug: "detail-problem",
        authorId: author.id,
        difficulty: "medium",
        visibility: "public",
        defaultTitle: "Detail Problem"
      });

      const detail = await getProblemPageData("detail-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.slug).toBe("detail-problem");
      expect(detail!.title).toBe("Detail Problem");
      expect(detail!.difficulty).toBe("medium");
      expect(detail!.authorUsername).toBe("prof");
      expect(detail!.visibility).toBe("public");
    });

    it("includes sample testcases from non-hidden testcase set", async () => {
      await createTestProblem({
        slug: "samples-problem",
        visibility: "public"
      });

      // The factory already creates a sample testcase set with one testcase
      const detail = await getProblemPageData("samples-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.samples.length).toBeGreaterThanOrEqual(1);
      expect(detail!.samples[0]!.input).toBe("1 2");
      expect(detail!.samples[0]!.output).toBe("3");
    });

    it("includes input/output format from statement", async () => {
      await createTestProblem({
        slug: "format-problem",
        visibility: "public"
      });

      const detail = await getProblemPageData("format-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.inputFormat).toBe("Test input format");
      expect(detail!.outputFormat).toBe("Test output format");
    });

    it("counts total submissions and acceptance rate", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({
        slug: "counted-problem",
        authorId: user.id,
        visibility: "public"
      });

      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        mode: "practice"
      });
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "wrong_answer",
        mode: "practice"
      });
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        mode: "practice"
      });

      const detail = await getProblemPageData("counted-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.totalSubmissions).toBe(3);
      // 2 accepted out of 3
      expect(detail!.acceptanceRate).toBeCloseTo(2 / 3, 5);
    });
  });

  // --- listSolvedProblemSlugs ---

  describe("listSolvedProblemSlugs", () => {
    it("returns slugs of problems the user has solved (accepted, non-sampleOnly)", async () => {
      const user = await createTestUser();
      const p1 = await createTestProblem({ slug: "solved-1", authorId: user.id });
      const p2 = await createTestProblem({ slug: "solved-2", authorId: user.id });
      const p3 = await createTestProblem({ slug: "unsolved", authorId: user.id });

      await createTestSubmission({
        userId: user.id,
        problemId: p1.id,
        status: "accepted",
        sampleOnly: false,
        mode: "practice"
      });
      await createTestSubmission({
        userId: user.id,
        problemId: p2.id,
        status: "accepted",
        sampleOnly: false,
        mode: "practice"
      });
      // Only sampleOnly accepted -- should not count
      await createTestSubmission({
        userId: user.id,
        problemId: p3.id,
        status: "accepted",
        sampleOnly: true,
        mode: "practice"
      });

      const slugs = await listSolvedProblemSlugs(user.id);
      expect(slugs).toContain("solved-1");
      expect(slugs).toContain("solved-2");
      expect(slugs).not.toContain("unsolved");
    });

    it("returns empty array for user with no accepted submissions", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({ authorId: user.id });

      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "wrong_answer",
        sampleOnly: false,
        mode: "practice"
      });

      const slugs = await listSolvedProblemSlugs(user.id);
      expect(slugs).toEqual([]);
    });

    it("returns empty array for nonexistent user", async () => {
      const slugs = await listSolvedProblemSlugs("nonexistent-user");
      expect(slugs).toEqual([]);
    });
  });

  // --- getCoursePageData (read model) ---

  describe("getCoursePageData (read model)", () => {
    it("returns course with assessments and their problem slugs", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({
        slug: "read-model-course",
        ownerId: teacher.id
      });
      const problem = await createTestProblem({ authorId: teacher.id });

      // Add membership
      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: teacher.id,
          role: "teacher",
          status: "active",
          joinedAt: new Date(),
          joinedVia: "manual_invite"
        }
      });

      // Add problem to course
      await testPrisma.courseProblem.create({
        data: {
          courseId: course.id,
          problemId: problem.id,
          addedByUserId: teacher.id
        }
      });

      // Add assessment with linked problem
      const assessment = await testPrisma.courseAssessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Midterm",
          slug: "midterm",
          summary: "Midterm exam",
          opensAt: new Date("2026-01-01"),
          dueAt: new Date("2026-06-01"),
          closesAt: new Date("2026-06-01"),
          status: "published",
          scoreboardMode: "hidden"
        }
      });

      await testPrisma.courseAssessmentProblem.create({
        data: {
          assessmentId: assessment.id,
          problemId: problem.id,
          ordinal: 1,
          points: 100
        }
      });

      const data = await getCoursePageData("read-model-course");
      expect(data).not.toBeNull();
      expect(data!.course.slug).toBe("read-model-course");
      expect(data!.course.assessments).toHaveLength(1);
      expect(data!.course.assessments[0]!.title).toBe("Midterm");
      expect(data!.course.assessments[0]!.problemSlugs).toContain(problem.slug);
      expect(data!.course.members).toHaveLength(1);
      expect(data!.problems).toHaveLength(1);
    });
  });

  // --- listCourseCards (read model) ---

  describe("listCourseCards (read model)", () => {
    it("returns cards with slug and title", async () => {
      await createTestCourse({ slug: "rm-course-1", title: "Read Model 1" });
      await createTestCourse({ slug: "rm-course-2", title: "Read Model 2" });

      const cards = await listCourseCards();
      expect(cards).toHaveLength(2);
      const slugs = cards.map((c) => c.slug);
      expect(slugs).toContain("rm-course-1");
      expect(slugs).toContain("rm-course-2");
    });
  });
});
