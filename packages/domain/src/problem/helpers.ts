import { problemRepo, problemWorkspaceFileRepo, type TransactionClient } from "@nojv/db";
import type { Language, PlatformRole } from "@nojv/core";
import { entryFileNameFor } from "@nojv/core";

import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";

export interface ProblemActorContext {
  userId: string;
  username: string;
  platformRole: PlatformRole;
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

/**
 * Gate every viewer-side access to problem data (page load, submit, run).
 * Returns silently when allowed, throws NotFoundError otherwise (never 403 —
 * we hide the problem's existence from unauthorized viewers to prevent
 * enumeration).
 *
 * Public problems are visible to anyone logged in. Private problems are
 * only visible to the author, platform admins, and to viewers who arrive
 * with a valid assessment/contest context that contains the problem —
 * the caller is responsible for verifying that context (enrollment,
 * time window, problem membership) BEFORE calling this function and
 * passing `contextIncludesProblem: true`.
 */
export function assertProblemViewAccess(
  problem: { id: string; authorId: string | null; visibility: string },
  actor: ProblemActorContext | null,
  opts?: { contextIncludesProblem?: boolean }
): void {
  if (problem.visibility === "public") return;
  if (actor?.platformRole === "admin") return;
  if (actor?.userId === problem.authorId) return;
  if (opts?.contextIncludesProblem) return;
  // Mask the existence of the private problem — use 404 not 403.
  throw new NotFoundError(`Problem not found: ${problem.id}`);
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
