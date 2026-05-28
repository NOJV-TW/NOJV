import { assessmentRepo, contestRepo, editorialRepo, examRepo, submissionRepo } from "@nojv/db";

export async function hasUserAcProblem(userId: string, problemId: string): Promise<boolean> {
  const count = await submissionRepo.count({
    userId,
    problemId,
    status: "accepted",
    sampleOnly: false,
  });
  return count > 0;
}

export type EditorialViewContext =
  | { kind: "practice" }
  | { kind: "contest"; contestId: string; now: Date }
  | { kind: "assignment"; assignmentId: string; now: Date }
  | { kind: "exam"; examId: string; now: Date };

// Defensive: if the active event row can't be resolved (deleted, stale link, race),
// don't lock the student out — fall through to the AC-only check.
async function contextGateOpen(context: EditorialViewContext): Promise<boolean> {
  switch (context.kind) {
    case "practice":
      return true;
    case "contest": {
      const contest = await contestRepo.findById(context.contestId);
      if (!contest) return true;
      return context.now.getTime() >= contest.endsAt.getTime();
    }
    case "assignment": {
      try {
        const assessment = await assessmentRepo.findInfoById(context.assignmentId);
        return context.now.getTime() >= assessment.closesAt.getTime();
      } catch {
        return true;
      }
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) return true;
      return context.now.getTime() >= exam.endsAt.getTime();
    }
  }
}

/**
 * Editorial visibility gate. Authors of any editorial for the problem
 * always see it (grandfather rule — a rejudge overturning their AC must
 * not lock them out of their own writing). Otherwise the user must have
 * an accepted submission AND the contextual event (contest/assignment/exam)
 * must have already ended — past-practice AC alone is not enough to read
 * editorials during an active contest reuse of the same problem.
 */
export async function canViewEditorials(
  userId: string,
  problemId: string,
  context: EditorialViewContext = { kind: "practice" },
): Promise<boolean> {
  const authored = await editorialRepo.existsForUserProblem(userId, problemId);
  if (authored) return true;

  const ac = await hasUserAcProblem(userId, problemId);
  if (!ac) return false;

  return contextGateOpen(context);
}

export async function listProblemEditorials(problemId: string) {
  return editorialRepo.listByProblemId(problemId);
}

export interface ListEditorialsPageInput {
  problemId: string;
  page: number;
  pageSize: number;
}

/**
 * Paginated read for the dedicated editorial list page. Returns the
 * page slice plus the total count so the UI can render page controls.
 */
export async function listEditorialsPage({
  problemId,
  page,
  pageSize,
}: ListEditorialsPageInput) {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const skip = (safePage - 1) * safeSize;
  const [items, total] = await Promise.all([
    editorialRepo.listByProblemIdPaged(problemId, skip, safeSize),
    editorialRepo.countByProblemId(problemId),
  ]);
  return { items, total, page: safePage, pageSize: safeSize };
}

// intentional-nullable: edit-page loader maps null to the standard 404; mutations promote it to NotFoundError. Caller chooses the error so this stays a plain "row not visible" signal.
export async function getEditorialById(id: string) {
  const row = await editorialRepo.findById(id);
  if (!row || row.deletedAt) return null;
  return row;
}
