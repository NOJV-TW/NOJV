import { describe, expect, it } from "vitest";

import { ForbiddenError, problemDomain } from "@nojv/domain";
import { checkerKey, createStorageClient, getText } from "@nojv/storage";

import { createTestProblem, createTestUser } from "../../fixtures/factories";

import type { ProblemActorContext } from "../../../packages/domain/src/problem/permissions";

/**
 * Route-level coverage for `POST /api/problems/[id]/checker`. The HTTP
 * wrapper is a thin adapter — auth, size cap, language parsing, then
 * delegation to `assertProblemStorageBudget` + `setProblemChecker`.
 *
 * We exercise the domain helpers directly (the convention in this suite):
 *   - teacher path  → `setProblemChecker` writes blob + flips judgeConfig
 *   - student path  → `setProblemChecker` rejects with ForbiddenError (403)
 *   - oversize path → `assertProblemStorageBudget` rejects (the route maps
 *                     budget-overrun + per-file 5 MB caps to HTTP 413/409
 *                     respectively; both are byte-count assertions).
 */

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

    const stored = await getText(createStorageClient(), checkerKey(problem.id));
    expect(stored).toBe("#include <iostream>\nint main(){return 0;}\n");

    // The mock createStorageClient returns `{}` in integration setup, but
    // the helper is still callable — we already asserted the put via getText
    // above. Now verify the row's judgeConfig carries the storage key + lang.
    const { problemRepo } = await import("@nojv/db");
    const row = await problemRepo.findById(problem.id);
    const config = row?.judgeConfig as {
      type?: string;
      checkerKey?: string;
      checkerLanguage?: string;
    };
    expect(config?.type).toBe("checker");
    expect(config?.checkerKey).toBe(checkerKey(problem.id));
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

    // No blob was written under the problem prefix.
    await expect(getText(createStorageClient(), checkerKey(problem.id))).rejects.toThrow(
      /No body returned/,
    );
  });

  it("oversize uploads are rejected by the per-problem 50 MB budget (HTTP 413)", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });

    // 51 MB delta > 50 MB budget → ConflictError. The route forwards this
    // to the client (after its own 5 MB per-file 413 check, which is
    // strictly stricter).
    await expect(
      problemDomain.assertProblemStorageBudget(problem.id, 51 * 1024 * 1024),
    ).rejects.toThrow(/storage budget exceeded/i);
  });
});
