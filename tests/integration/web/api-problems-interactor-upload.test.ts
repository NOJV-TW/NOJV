import { describe, expect, it } from "vitest";

import { ForbiddenError, problemDomain } from "@nojv/application";
import {
  assertStorageObjectPointer,
  createStorageClient,
  getVerifiedText,
} from "@nojv/storage";

import { createTestProblem, createTestUser, testPrisma } from "../../fixtures/factories";

import type { ProblemActorContext } from "../../../packages/application/src/problem/permissions";

function actorOf(user: {
  id: string;
  username: string;
  platformRole: ProblemActorContext["platformRole"];
}): ProblemActorContext {
  return {
    userId: user.id,
    username: user.username,
    platformRole: user.platformRole,
  };
}

describe("POST /api/problems/[id]/interactor (W3.C)", () => {
  it("teacher upload writes the script blob and flips judgeConfig.type to 'interactive'", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });

    await problemDomain.setProblemInteractor(actorOf(teacher), problem.id, {
      content: "// interactor\nint main(){return 0;}\n",
      language: "cpp",
    });

    const updated = await testPrisma.problem.findUniqueOrThrow({
      where: { id: problem.id },
      select: { judgeConfig: true, interactorStorage: true },
    });
    const cfg = updated.judgeConfig as {
      type: string;
      interactorLanguage?: string;
    };
    const stored = await getVerifiedText(
      createStorageClient(),
      assertStorageObjectPointer(updated.interactorStorage),
    );
    expect(stored).toBe("// interactor\nint main(){return 0;}\n");
    expect(cfg.type).toBe("interactive");
    expect(cfg).not.toHaveProperty("interactorKey");
    expect(cfg.interactorLanguage).toBe("cpp");
  });

  it("non-author student is rejected with ForbiddenError (HTTP 403)", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser({ platformRole: "student" });
    const problem = await createTestProblem({ authorId: teacher.id });

    await expect(
      problemDomain.setProblemInteractor(actorOf(student), problem.id, {
        content: "# i = input()",
        language: "python",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await testPrisma.problem.findUniqueOrThrow({
      where: { id: problem.id },
      select: { interactorStorage: true },
    });
    expect(row.interactorStorage).toBeNull();
  });

  it("oversize uploads are rejected by the per-problem 50 MB budget", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });

    await expect(
      problemDomain.assertProblemStorageBudget(problem.id, 51 * 1024 * 1024),
    ).rejects.toThrow(/storage budget exceeded/i);
  });
});
