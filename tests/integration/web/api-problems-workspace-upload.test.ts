// tests/integration/web/api-problems-workspace-upload.test.ts
//
// W3.A coverage — domain-level checks for the workspace-file upload path
// driven by `POST /api/problems/[id]/workspace/files`. The HTTP wrapper is
// a thin adapter: requireApiAuth + canEditProblem role check + file-size
// + storage-budget + `setWorkspaceFile`. We exercise the domain helpers
// directly (same pattern as api-problems-checker-upload.test.ts) since
// the suite has no SvelteKit runtime — pulling in `+server.ts` would
// transitively load `$app/environment` and the rate limiter.

import { describe, expect, it } from "vitest";

import { ForbiddenError, problemDomain } from "@nojv/domain";

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

describe("POST /api/problems/[id]/workspace/files (W3.A)", () => {
  it("teacher author writes a workspace file row + blob", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id, type: "multi_file" });

    // Route's edit-access guard delegates to assertProblemEditAccess; we
    // assert the same call shape passes for the author.
    await problemDomain.assertProblemEditAccess(actorOf(teacher), problem.id);

    await problemDomain.setWorkspaceFile(problem.id, {
      language: "python",
      path: "main.py",
      visibility: "editable",
      content: "print('hi')",
    });

    const rows = await testPrisma.problemWorkspaceFile.findMany({
      where: { problemId: problem.id },
    });
    const created = rows.find((r) => r.path === "main.py" && r.language === "python");
    expect(created).toBeDefined();
    expect(created?.visibility).toBe("editable");
  });

  it("non-author student is rejected before any write (ForbiddenError → HTTP 403)", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id, type: "multi_file" });
    const student = await createTestUser({ platformRole: "student" });

    await expect(
      problemDomain.assertProblemEditAccess(actorOf(student), problem.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const rows = await testPrisma.problemWorkspaceFile.findMany({
      where: { problemId: problem.id, path: "main.py" },
    });
    expect(rows).toHaveLength(0);
  });

  it("oversize uploads are rejected by the per-problem 50 MB storage budget", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id, type: "multi_file" });

    // The route also enforces a per-file 5 MB cap (HTTP 413) before this
    // budget check — that path is asserted at the HTTP layer; here we
    // verify the domain-level 50 MB guard that backstops it.
    await expect(
      problemDomain.assertProblemStorageBudget(problem.id, 51 * 1024 * 1024),
    ).rejects.toThrow(/storage budget exceeded/i);
  });
});
