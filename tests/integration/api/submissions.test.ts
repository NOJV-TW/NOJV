import { describe, expect, it } from "vitest";

import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { submissionDomain } from "@nojv/domain";

const { getSubmissionForUser, listProblemSubmissions } = submissionDomain;
import { NotFoundError } from "$lib/server/auth";

describe("submission queries (real DB)", () => {
  // --- getSubmissionForUser ---

  describe("getSubmissionForUser", () => {
    it("returns submission when user is the owner", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({ authorId: user.id });
      const submission = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        mode: "practice"
      });

      const result = await getSubmissionForUser(submission.id, user.id, false);
      expect(result.id).toBe(submission.id);
      expect(result.userId).toBe(user.id);
    });

    it("returns submission when requester is admin (not owner)", async () => {
      const owner = await createTestUser();
      const admin = await createTestUser({ platformRole: "admin" });
      const problem = await createTestProblem({ authorId: owner.id });
      const submission = await createTestSubmission({
        userId: owner.id,
        problemId: problem.id,
        mode: "practice"
      });

      const result = await getSubmissionForUser(submission.id, admin.id, true);
      expect(result.id).toBe(submission.id);
    });

    it("throws NotFoundError when non-owner non-admin requests", async () => {
      const owner = await createTestUser();
      const other = await createTestUser();
      const problem = await createTestProblem({ authorId: owner.id });
      const submission = await createTestSubmission({
        userId: owner.id,
        problemId: problem.id,
        mode: "practice"
      });

      await expect(getSubmissionForUser(submission.id, other.id, false)).rejects.toThrow(
        NotFoundError
      );
    });

    it("throws NotFoundError for nonexistent submission id", async () => {
      const user = await createTestUser();

      await expect(getSubmissionForUser("nonexistent-id", user.id, false)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  // --- listProblemSubmissions ---

  describe("listProblemSubmissions", () => {
    it("returns submissions for a user on a specific problem", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({ authorId: user.id });

      // Create some accepted (non-sampleOnly) submissions
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        sampleOnly: false,
        mode: "practice"
      });
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "wrong_answer",
        sampleOnly: false,
        mode: "practice"
      });

      const results = await listProblemSubmissions(user.id, problem.slug);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.id)).toBe(true);
      expect(results.every((r) => r.submittedAt)).toBe(true);
    });

    it("excludes sampleOnly submissions", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({ authorId: user.id });

      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        sampleOnly: false,
        mode: "practice"
      });
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        sampleOnly: true,
        mode: "practice"
      });

      const results = await listProblemSubmissions(user.id, problem.slug);
      expect(results).toHaveLength(1);
    });

    it("returns empty array for nonexistent problem slug", async () => {
      const user = await createTestUser();
      const results = await listProblemSubmissions(user.id, "does-not-exist");
      expect(results).toEqual([]);
    });

    it("does not return another user's submissions", async () => {
      const user1 = await createTestUser();
      const user2 = await createTestUser();
      const problem = await createTestProblem({ authorId: user1.id });

      await createTestSubmission({
        userId: user1.id,
        problemId: problem.id,
        status: "accepted",
        sampleOnly: false,
        mode: "practice"
      });

      const results = await listProblemSubmissions(user2.id, problem.slug);
      expect(results).toHaveLength(0);
    });

    it("returns submissions ordered by createdAt desc", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({ authorId: user.id });

      const sub1 = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "wrong_answer",
        sampleOnly: false,
        mode: "practice"
      });

      // Small delay to ensure different createdAt
      await new Promise((r) => setTimeout(r, 50));

      const sub2 = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        sampleOnly: false,
        mode: "practice"
      });

      const results = await listProblemSubmissions(user.id, problem.slug);
      expect(results).toHaveLength(2);
      // Most recent first
      expect(results[0]!.id).toBe(sub2.id);
      expect(results[1]!.id).toBe(sub1.id);
    });
  });

  // --- Submission factory sanity ---

  describe("factory sanity", () => {
    it("createTestSubmission persists to DB with correct fields", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({ authorId: user.id });
      const submission = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        language: "cpp",
        status: "wrong_answer",
        sourceCode: "int main() {}",
        mode: "practice"
      });

      const fetched = await testPrisma.submission.findUnique({
        where: { id: submission.id }
      });
      expect(fetched).not.toBeNull();
      expect(fetched!.language).toBe("cpp");
      expect(fetched!.status).toBe("wrong_answer");
      expect(fetched!.sourceCode).toBe("int main() {}");
      expect(fetched!.userId).toBe(user.id);
      expect(fetched!.problemId).toBe(problem.id);
    });
  });
});
