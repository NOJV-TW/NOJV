import { describe, expect, it } from "vitest";

import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

import { submissionDomain, type ActorContext } from "@nojv/application";
import { submissionSourcePrefix } from "@nojv/storage";

const { getSubmissionForActor, getSubmissionSources, listProblemSubmissions } =
  submissionDomain;
import { NotFoundError } from "$lib/server/auth";

function actorOf(user: {
  id: string;
  email: string;
  username: string;
  name: string;
  platformRole: string;
}): ActorContext {
  return {
    userId: user.id,
    email: user.email,
    username: user.username,
    displayName: user.name,
    platformRole: user.platformRole as ActorContext["platformRole"],
  };
}

describe("submission queries (real DB)", () => {
  describe("getSubmissionForActor", () => {
    it("returns submission when user is the owner", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({ authorId: user.id });
      const submission = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
      });

      const result = await getSubmissionForActor(actorOf(user), submission.id);
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
      });

      const result = await getSubmissionForActor(actorOf(admin), submission.id);
      expect(result.id).toBe(submission.id);
    });

    it("throws NotFoundError when non-owner non-admin requests", async () => {
      const owner = await createTestUser();
      const other = await createTestUser();
      const problem = await createTestProblem({ authorId: owner.id });
      const submission = await createTestSubmission({
        userId: owner.id,
        problemId: problem.id,
      });

      await expect(getSubmissionForActor(actorOf(other), submission.id)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws NotFoundError for nonexistent submission id", async () => {
      const user = await createTestUser();

      await expect(getSubmissionForActor(actorOf(user), "nonexistent-id")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("listProblemSubmissions", () => {
    it("returns submissions for a user on a specific problem", async () => {
      const user = await createTestUser();
      const problem = await createTestProblem({ authorId: user.id });

      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        sampleOnly: false,
      });
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "wrong_answer",
        sampleOnly: false,
      });

      const results = await listProblemSubmissions(user.id, problem.id);
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
      });
      await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        sampleOnly: true,
      });

      const results = await listProblemSubmissions(user.id, problem.id);
      expect(results).toHaveLength(1);
    });

    it("returns empty array for nonexistent problem id", async () => {
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
      });

      const results = await listProblemSubmissions(user2.id, problem.id);
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
      });

      await new Promise((r) => setTimeout(r, 50));

      const sub2 = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "accepted",
        sampleOnly: false,
      });

      const results = await listProblemSubmissions(user.id, problem.id);
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe(sub2.id);
      expect(results[1]!.id).toBe(sub1.id);
    });
  });

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
      });

      const fetched = await testPrisma.submission.findUnique({
        where: { id: submission.id },
      });
      expect(fetched).not.toBeNull();
      expect(fetched!.language).toBe("cpp");
      expect(fetched!.status).toBe("wrong_answer");
      expect(fetched!.sourceStoragePrefix).toBe(submissionSourcePrefix(submission.id));
      const sources = await getSubmissionSources(submission.id);
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0]!.content).toBe("int main() {}");
      expect(fetched!.userId).toBe(user.id);
      expect(fetched!.problemId).toBe(problem.id);
    });
  });
});
