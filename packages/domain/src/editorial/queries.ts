import {
  assessmentProblemRepo,
  assessmentRepo,
  contestProblemRepo,
  contestRepo,
  editorialRepo,
  examProblemRepo,
  examRepo,
  submissionRepo,
} from "@nojv/db";

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

async function contextGateOpen(context: EditorialViewContext): Promise<boolean> {
  switch (context.kind) {
    case "practice":
      return true;
    case "contest": {
      const contest = await contestRepo.findById(context.contestId).catch(() => null);
      if (!contest) return false;
      return context.now.getTime() >= contest.endsAt.getTime();
    }
    case "assignment": {
      const assessment = await assessmentRepo
        .findInfoById(context.assignmentId)
        .catch(() => null);
      if (!assessment) return false;
      return context.now.getTime() >= assessment.closesAt.getTime();
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId).catch(() => null);
      if (!exam) return false;
      return context.now.getTime() >= exam.endsAt.getTime();
    }
  }
}

export async function canViewEditorials(
  userId: string,
  problemId: string,
  context?: EditorialViewContext,
): Promise<boolean> {
  const gateOpen = await contextGateOpen(context ?? { kind: "practice" });
  if (!gateOpen) return false;

  const authored = await editorialRepo.existsForUserProblem(userId, problemId);
  if (authored) return true;

  return hasUserAcProblem(userId, problemId);
}

export async function resolveActiveContextForUser(
  userId: string,
  problemId: string,
  now: Date,
): Promise<EditorialViewContext> {
  const [contests, assignments, exams] = await Promise.all([
    contestProblemRepo.findActiveContestsForUser(problemId, userId, now),
    assessmentProblemRepo.findActiveAssessmentsForUser(problemId, userId, now),
    examProblemRepo.findActiveExamsForUser(problemId, userId, now),
  ]);

  const candidates: { context: EditorialViewContext; deadline: number }[] = [];
  for (const row of contests) {
    candidates.push({
      context: { kind: "contest", contestId: row.contest.id, now },
      deadline: row.contest.endsAt.getTime(),
    });
  }
  for (const row of assignments) {
    candidates.push({
      context: { kind: "assignment", assignmentId: row.assessment.id, now },
      deadline: row.assessment.closesAt.getTime(),
    });
  }
  for (const row of exams) {
    candidates.push({
      context: { kind: "exam", examId: row.exam.id, now },
      deadline: row.exam.endsAt.getTime(),
    });
  }

  let strictest: { context: EditorialViewContext; deadline: number } | undefined;
  for (const candidate of candidates) {
    if (!strictest || candidate.deadline > strictest.deadline) {
      strictest = candidate;
    }
  }
  return strictest ? strictest.context : { kind: "practice" };
}

export async function listProblemEditorials(problemId: string, viewerId: string) {
  const rows = await editorialRepo.listByProblemId(problemId);
  return rows.map(({ votes, ...rest }) => ({
    ...rest,
    voteScore: votes.reduce((sum, v) => sum + v.value, 0),
    viewerVote: votes.find((v) => v.userId === viewerId)?.value ?? 0,
  }));
}

export interface ListEditorialsPageInput {
  problemId: string;
  page: number;
  pageSize: number;
}

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
