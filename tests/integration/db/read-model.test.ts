import { describe, expect, it } from "vitest";

import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { problemDomain, courseDomain } from "@nojv/domain";

const { listProblemCards, getProblemPageData } = problemDomain;
const { getCoursePageData, listCourseCards } = courseDomain;

describe("read model (real DB)", () => {
  // --- listProblemCards ---

  describe("listProblemCards", () => {
    it("returns public problems only", async () => {
      await createTestProblem({ visibility: "public", title: "Public P" });
      await createTestProblem({ visibility: "private", title: "Private P" });

      const result = await listProblemCards();
      expect(result.problems).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.problems[0]!.title).toBe("Public P");
    });

    it("returns empty array when no problems exist", async () => {
      const result = await listProblemCards();
      expect(result.problems).toEqual([]);
      expect(result.totalCount).toBe(0);
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

      const result = await listProblemCards();
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]!.totalSubmissions).toBe(2);
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

      const result = await listProblemCards();
      expect(result.problems[0]!.acceptanceRate).toBe(0.5);
    });

    it("returns 0 acceptance rate when no submissions", async () => {
      await createTestProblem({ visibility: "public" });

      const result = await listProblemCards();
      expect(result.problems[0]!.acceptanceRate).toBe(0);
    });

    it("includes id, difficulty, and tags", async () => {
      await createTestProblem({
        id: "two-sum",
        difficulty: "hard",
        visibility: "public",
        tags: ["array", "hash-table"]
      });

      const result = await listProblemCards();
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]!.id).toBe("two-sum");
      expect(result.problems[0]!.difficulty).toBe("hard");
      // Difficulty tag ("hard") is merged into tags by the factory; the
      // domain query exposes both the derived `difficulty` + the full tag list.
      expect(result.problems[0]!.tags).toEqual(["hard", "array", "hash-table"]);
    });
  });

  // --- getProblemPageData ---

  describe("getProblemPageData", () => {
    it("returns null for nonexistent id", async () => {
      const result = await getProblemPageData("nonexistent");
      expect(result).toBeNull();
    });

    it("returns full problem detail with statement and samples", async () => {
      const author = await createTestUser({ platformRole: "teacher", username: "prof" });
      await createTestProblem({
        id: "detail-problem",
        authorId: author.id,
        difficulty: "medium",
        visibility: "public",
        title: "Detail Problem"
      });

      const detail = await getProblemPageData("detail-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe("detail-problem");
      expect(detail!.title).toBe("Detail Problem");
      expect(detail!.difficulty).toBe("medium");
      expect(detail!.authorUsername).toBe("prof");
      expect(detail!.visibility).toBe("public");
    });

    it("surfaces Problem.samples on the read model", async () => {
      await createTestProblem({
        id: "samples-problem",
        visibility: "public"
      });

      // The factory writes a default `samples` pair on `Problem` matching
      // the default testcase — samples live on `Problem.samples` directly
      // since Phase 1, not on a specially-flagged testcase set.
      const detail = await getProblemPageData("samples-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.samples.length).toBeGreaterThanOrEqual(1);
      expect(detail!.samples[0]!.stdin).toBe("1 2");
      expect(detail!.samples[0]!.expected).toBe("3");
    });

    it("includes input/output format from statement", async () => {
      await createTestProblem({
        id: "format-problem",
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
        id: "counted-problem",
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
          joinedTokenId: null
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
          status: "published"
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
      expect(data!.course.assessments[0]!.problemIds).toContain(problem.id);
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
