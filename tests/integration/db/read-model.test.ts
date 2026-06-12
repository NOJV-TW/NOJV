import { describe, expect, it } from "vitest";

import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

import { problemDomain, courseDomain } from "@nojv/domain";

const { listProblemCards, getProblemPageData } = problemDomain;
const { listCourseCards } = courseDomain;

describe("read model (real DB)", () => {
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

    it("counts distinct attempters as totalSubmissions", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      const problem = await createTestProblem({
        authorId: userA.id,
        visibility: "public",
      });

      await createTestSubmission({
        userId: userA.id,
        problemId: problem.id,
        status: "accepted",
      });
      await createTestSubmission({
        userId: userA.id,
        problemId: problem.id,
        status: "wrong_answer",
      });
      await createTestSubmission({
        userId: userB.id,
        problemId: problem.id,
        status: "wrong_answer",
      });

      const result = await listProblemCards();
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]!.totalSubmissions).toBe(2);
    });

    it("calculates acceptance rate as solvers / attempters", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      const problem = await createTestProblem({
        authorId: userA.id,
        visibility: "public",
      });

      await createTestSubmission({
        userId: userA.id,
        problemId: problem.id,
        status: "accepted",
      });
      await createTestSubmission({
        userId: userB.id,
        problemId: problem.id,
        status: "wrong_answer",
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
        tags: ["array", "hash-table"],
      });

      const result = await listProblemCards();
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]!.id).toBe("two-sum");
      expect(result.problems[0]!.difficulty).toBe("hard");
      expect(result.problems[0]!.tags).toEqual(["array", "hash-table"]);
    });
  });

  describe("getProblemPageData", () => {
    it("throws NotFoundError for nonexistent id", async () => {
      await expect(getProblemPageData("nonexistent")).rejects.toThrow(
        "Problem not found: nonexistent",
      );
    });

    it("returns full problem detail with statement and samples", async () => {
      const author = await createTestUser({ platformRole: "teacher", username: "prof" });
      await createTestProblem({
        id: "detail-problem",
        authorId: author.id,
        difficulty: "medium",
        visibility: "public",
        title: "Detail Problem",
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
        visibility: "public",
      });

      const detail = await getProblemPageData("samples-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.samples.length).toBeGreaterThanOrEqual(1);
      expect(detail!.samples[0]!.input).toBe("1 2");
      expect(detail!.samples[0]!.output).toBe("3");
    });

    it("includes input/output format from statement", async () => {
      await createTestProblem({
        id: "format-problem",
        visibility: "public",
      });

      const detail = await getProblemPageData("format-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.inputFormat).toBe("Test input format");
      expect(detail!.outputFormat).toBe("Test output format");
    });

    it("counts distinct attempters and acceptance rate", async () => {
      const author = await createTestUser({ platformRole: "teacher" });
      const userA = await createTestUser();
      const userB = await createTestUser();
      const userC = await createTestUser();
      const problem = await createTestProblem({
        id: "counted-problem",
        authorId: author.id,
        visibility: "public",
      });

      await createTestSubmission({
        userId: userA.id,
        problemId: problem.id,
        status: "accepted",
      });
      await createTestSubmission({
        userId: userA.id,
        problemId: problem.id,
        status: "wrong_answer",
      });
      await createTestSubmission({
        userId: userB.id,
        problemId: problem.id,
        status: "accepted",
      });
      await createTestSubmission({
        userId: userC.id,
        problemId: problem.id,
        status: "wrong_answer",
      });

      const detail = await getProblemPageData("counted-problem", "en");
      expect(detail).not.toBeNull();
      expect(detail!.totalSubmissions).toBe(3);
      expect(detail!.acceptanceRate).toBeCloseTo(2 / 3, 5);
    });
  });

  describe("listCourseCards (read model)", () => {
    it("returns cards keyed by course id", async () => {
      const a = await createTestCourse({ title: "Read Model 1" });
      const b = await createTestCourse({ title: "Read Model 2" });

      const cards = await listCourseCards();
      expect(cards).toHaveLength(2);
      const ids = cards.map((c) => c.id);
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
    });
  });
});
