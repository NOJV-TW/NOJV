import { problemRepo, problemWorkspaceFileRepo, type TransactionClient } from "@nojv/db";
import type { Language, PlatformRole } from "@nojv/core";
import { entryFileNameFor } from "@nojv/core";

import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";

export interface ProblemActorContext {
  userId: string;
  username: string;
  platformRole: PlatformRole;
}

export async function requireProblem(tx: TransactionClient, problemId: string) {
  const problem = await problemRepo.withTx(tx).findById(problemId);

  if (!problem) {
    throw new NotFoundError(`Problem not found: ${problemId}`);
  }

  return problem;
}

export function assertCourseProblemAccess(
  problem: { authorId: string | null; visibility: string },
  actor: ProblemActorContext
) {
  if (
    problem.visibility === "private" &&
    actor.platformRole !== "admin" &&
    problem.authorId !== actor.userId
  ) {
    throw new ForbiddenError(
      "Private problems can only be attached by their author or an admin."
    );
  }
}

export function assertProblemOwnership(
  problem: { authorId: string | null },
  actor: ProblemActorContext
) {
  if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
    throw new ForbiddenError("Only the author or an admin can modify this problem.");
  }
}

export async function assertProblemEditAccess(
  actor: ProblemActorContext,
  problemId: string
): Promise<void> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  assertProblemOwnership(problem, actor);
}

// Every listed language must have an editable main.<ext> workspace file,
// otherwise students in that language have no entry file to submit.
export async function assertProblemHasWorkspaceForLanguages(
  tx: TransactionClient,
  problemId: string,
  allowedLanguages: Language[]
): Promise<void> {
  if (allowedLanguages.length === 0) return;

  const workspaceFiles = await problemWorkspaceFileRepo.findByProblemId(problemId);

  const missing: Language[] = [];
  for (const language of allowedLanguages) {
    const entryPath = entryFileNameFor(language);
    const hasEntry = workspaceFiles.some(
      (f) => f.language === language && f.path === entryPath && f.visibility === "editable"
    );
    if (!hasEntry) missing.push(language);
  }

  if (missing.length > 0) {
    throw new ValidationError(
      `Problem ${problemId} is missing editable main.<ext> files for: ${missing.join(", ")}.`
    );
  }
}
