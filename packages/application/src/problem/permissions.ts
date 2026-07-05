import {
  assessmentProblemRepo,
  contestProblemRepo,
  courseMembershipRepo,
  examProblemRepo,
  problemRepo,
  problemWorkspaceFileRepo,
  type TransactionClient,
} from "@nojv/db";
import type { Language, PlatformRole } from "@nojv/core";
import { entryFileNameFor } from "@nojv/core";

import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";
import { canCreateProblem } from "../shared/permissions";

/**
 * Whether a user may author problems: platform teachers/admins, verified
 * accounts, or staff (teacher/TA) of any non-archived course.
 */
export async function canAuthorProblems(actor: {
  userId: string;
  platformRole: PlatformRole;
  emailVerified: boolean;
}): Promise<boolean> {
  if (canCreateProblem(actor.platformRole, actor.emailVerified)) return true;
  return courseMembershipRepo.hasActiveStaffMembership(actor.userId);
}

export interface ProblemActorContext {
  userId: string;
  username: string;
  platformRole: PlatformRole;
}

export function assertCourseProblemAccess(
  problem: { authorId: string | null; visibility: string },
  actor: ProblemActorContext,
) {
  if (
    problem.visibility === "private" &&
    actor.platformRole !== "admin" &&
    problem.authorId !== actor.userId
  ) {
    throw new ForbiddenError(
      "Private problems can only be attached by their author or an admin.",
    );
  }
}

export function assertProblemOwnership(
  problem: { authorId: string | null },
  actor: ProblemActorContext,
) {
  if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
    throw new ForbiddenError("Only the author or an admin can modify this problem.");
  }
}

export async function assertProblemEditAccess(
  actor: ProblemActorContext,
  problemId: string,
): Promise<void> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  assertProblemOwnership(problem, actor);
}

export async function assertProblemViewAccess(
  problem: { id: string; authorId: string | null; visibility: string },
  actor: ProblemActorContext | null,
  opts?: { contextIncludesProblem?: boolean; now?: Date },
): Promise<void> {
  if (problem.visibility === "public") return;
  if (actor?.platformRole === "admin") return;
  if (actor?.userId === problem.authorId) return;
  if (opts?.contextIncludesProblem) return;

  if (actor?.userId) {
    const now = opts?.now ?? new Date();
    const [assignment, contest, exam] = await Promise.all([
      assessmentProblemRepo.hasEndedAssessmentForUser(problem.id, actor.userId, now),
      contestProblemRepo.hasEndedContestForUser(problem.id, actor.userId, now),
      examProblemRepo.hasEndedExamForUser(problem.id, actor.userId, now),
    ]);
    if (assignment || contest || exam) return;
  }

  throw new NotFoundError(`Problem not found: ${problem.id}`);
}

export async function assertProblemHasWorkspaceForLanguages(
  tx: TransactionClient,
  problemId: string,
  allowedLanguages: Language[],
): Promise<void> {
  if (allowedLanguages.length === 0) return;

  const problem = await problemRepo.withTx(tx).findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  if (problem.type !== "multi_file") return;

  const workspaceFiles = await problemWorkspaceFileRepo.findByProblemId(problemId);

  const missing: Language[] = [];
  for (const language of allowedLanguages) {
    const entryPath = entryFileNameFor(language);
    const hasEntry = workspaceFiles.some(
      (f) => f.language === language && f.path === entryPath && f.visibility === "editable",
    );
    if (!hasEntry) missing.push(language);
  }

  if (missing.length > 0) {
    throw new ValidationError(
      `Problem ${problemId} is missing editable main.<ext> files for: ${missing.join(", ")}.`,
    );
  }
}
