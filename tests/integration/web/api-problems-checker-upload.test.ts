import { describe, expect, it } from "vitest";

import { ForbiddenError, problemDomain } from "@nojv/application";
import {
  assertStorageObjectPointer,
  createStorageClient,
  getVerifiedText,
} from "@nojv/storage";

import { createTestProblem, createTestUser } from "../../fixtures/factories";

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

describe("POST /api/problems/[id]/checker (W3.B)", () => {
  it("teacher upload writes the script blob and flips judgeConfig.type to 'checker'", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });

    const result = await problemDomain.setProblemChecker(actorOf(teacher), problem.id, {
      content: "#include <iostream>\nint main(){return 0;}\n",
      language: "cpp",
    });

    expect(result.id).toBe(problem.id);

    const { problemRepo } = await import("@nojv/db");
    const row = await problemRepo.findById(problem.id);
    const config = row?.judgeConfig as {
      type?: string;
      checkerLanguage?: string;
    };
    const pointer = assertStorageObjectPointer(row?.checkerStorage);
    const stored = await getVerifiedText(createStorageClient(), pointer);
    expect(stored).toBe("#include <iostream>\nint main(){return 0;}\n");
    expect(config?.type).toBe("checker");
    expect(config).not.toHaveProperty("checkerKey");
    expect(config?.checkerLanguage).toBe("cpp");
  });

  it("student is rejected with ForbiddenError (HTTP 403) before any S3 write", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser({ platformRole: "student" });
    const problem = await createTestProblem({ authorId: teacher.id });

    await expect(
      problemDomain.setProblemChecker(actorOf(student), problem.id, {
        content: "print('hi')\n",
        language: "python",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const { problemRepo } = await import("@nojv/db");
    const row = await problemRepo.findById(problem.id);
    expect(row?.checkerStorage).toBeNull();
  });

  it("oversize uploads are rejected by the per-problem 50 MB budget (HTTP 413)", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });

    await expect(
      problemDomain.assertProblemStorageBudget(problem.id, 51 * 1024 * 1024),
    ).rejects.toThrow(/storage budget exceeded/i);
  });
});
