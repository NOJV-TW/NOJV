// tests/integration/web/api-problems-interactor-upload.test.ts
//
// W3.C coverage — domain-level checks for the interactor upload path driven
// by `POST /api/problems/[id]/interactor`. Same pattern as the W3.B checker
// suite: the HTTP wrapper is a thin adapter, the behaviour lives in
// `setProblemInteractor` + `assertProblemStorageBudget`. Exercising those
// directly keeps the suite outside the SvelteKit runtime, which the
// integration project's vitest config does not provide.

import { describe, expect, it } from "vitest";

import { ForbiddenError, problemDomain } from "@nojv/domain";
import { createStorageClient, getText, interactorKey } from "@nojv/storage";

import { createTestProblem, createTestUser, testPrisma } from "../../fixtures/factories";

import type { ProblemActorContext } from "../../../packages/domain/src/problem/permissions";

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

    const stored = await getText(createStorageClient(), interactorKey(problem.id));
    expect(stored).toBe("// interactor\nint main(){return 0;}\n");

    const updated = await testPrisma.problem.findUniqueOrThrow({
      where: { id: problem.id },
      select: { judgeConfig: true },
    });
    const cfg = updated.judgeConfig as {
      type: string;
      interactorKey?: string;
      interactorLanguage?: string;
    };
    expect(cfg.type).toBe("interactive");
    expect(cfg.interactorKey).toBe(interactorKey(problem.id));
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

    // No blob was written under the problem prefix.
    await expect(getText(createStorageClient(), interactorKey(problem.id))).rejects.toThrow(
      /No body returned/,
    );
  });

  it("oversize uploads are rejected by the per-problem 50 MB budget", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });

    await expect(
      problemDomain.assertProblemStorageBudget(problem.id, 51 * 1024 * 1024),
    ).rejects.toThrow(/storage budget exceeded/i);
  });
});
