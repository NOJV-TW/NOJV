import { expect, it } from "vitest";
import { problemDomain, submissionDomain, type ActorContext } from "@nojv/application";
import { problemCreateSchema, submissionDraftSchema } from "@nojv/core";

import { createTestProblem, createTestUser, testPrisma } from "../../fixtures/factories";

it.each(["submission", "problem"] as const)(
  "preserves an admin account when creating a %s outside admin mode",
  async (operation) => {
    const user = await createTestUser({ platformRole: "admin", isSuperAdmin: false });
    const actor: ActorContext = {
      userId: user.id,
      username: user.username!,
      email: user.email,
      displayName: user.name,
      platformRole: "student",
    };

    if (operation === "submission") {
      const problem = await createTestProblem();
      const submission = await submissionDomain.createQueuedSubmissionRecord(
        submissionDraftSchema.parse({
          problemId: problem.id,
          language: "python",
          sourceCode: "print(3)",
          context: { type: "practice" },
        }),
        actor,
        "127.0.0.1",
      );
      expect(submission).toMatchObject({ userId: user.id, status: "queued" });
    } else {
      const problem = await problemDomain.createProblemRecord(
        actor,
        problemCreateSchema.parse({
          title: "Admin private draft",
          statement: "Print 3.",
          inputFormat: "",
          outputFormat: "3",
          difficulty: "easy",
          memoryLimitMb: 256,
          timeLimitMs: 1000,
          visibility: "private",
        }),
      );
      expect(problem).toMatchObject({
        authorId: user.id,
        status: "draft",
        visibility: "private",
      });
    }

    await expect(
      testPrisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({
      platformRole: "admin",
      isSuperAdmin: false,
      securityGeneration: user.securityGeneration,
    });
  },
);
