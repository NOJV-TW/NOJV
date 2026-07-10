import {
  assessmentProblemRepo,
  assessmentRepo,
  contestProblemRepo,
  contestRepo,
  examProblemRepo,
  examRepo,
  postRepo,
  submissionRepo,
} from "@nojv/db";
import type { ProblemPostType } from "@nojv/core";

export async function hasUserAcProblem(userId: string, problemId: string): Promise<boolean> {
  const count = await submissionRepo.count({
    userId,
    problemId,
    status: "accepted",
    sampleOnly: false,
  });
  return count > 0;
}

export type PostViewContext =
  | { kind: "practice" }
  | { kind: "contest"; contestId: string; now: Date }
  | { kind: "assignment"; assignmentId: string; now: Date }
  | { kind: "exam"; examId: string; now: Date };

async function contextGateOpen(context: PostViewContext): Promise<boolean> {
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

export async function canViewPosts(
  userId: string,
  problemId: string,
  type: ProblemPostType,
  context?: PostViewContext,
): Promise<boolean> {
  const gateOpen = await contextGateOpen(context ?? { kind: "practice" });
  if (!gateOpen) return false;
  if (type === "discussion") return true;

  const authored = await postRepo.existsForUserProblem(userId, problemId);
  if (authored) return true;

  return hasUserAcProblem(userId, problemId);
}

export async function resolveActiveContextForUser(
  userId: string,
  problemId: string,
  now: Date,
): Promise<PostViewContext> {
  const [contests, assignments, exams] = await Promise.all([
    contestProblemRepo.findActiveContestsForUser(problemId, userId, now),
    assessmentProblemRepo.findActiveAssessmentsForUser(problemId, userId, now),
    examProblemRepo.findActiveExamsForUser(problemId, userId, now),
  ]);

  const candidates: { context: PostViewContext; deadline: number }[] = [];
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

  let strictest: { context: PostViewContext; deadline: number } | undefined;
  for (const candidate of candidates) {
    if (!strictest || candidate.deadline > strictest.deadline) {
      strictest = candidate;
    }
  }
  return strictest ? strictest.context : { kind: "practice" };
}

function voteAggregates(votes: { userId: string; value: number }[], viewerId: string) {
  return {
    voteScore: votes.reduce((sum, v) => sum + v.value, 0),
    viewerVote: votes.find((v) => v.userId === viewerId)?.value ?? 0,
  };
}

export interface ListPostsPageInput {
  problemId: string;
  type: ProblemPostType;
  viewerId: string;
  page: number;
  pageSize: number;
}

export async function listPostsPage({
  problemId,
  type,
  viewerId,
  page,
  pageSize,
}: ListPostsPageInput) {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const skip = (safePage - 1) * safeSize;
  const [rows, total] = await Promise.all([
    postRepo.listByProblemIdPaged(problemId, type, skip, safeSize),
    postRepo.countByProblemId(problemId, type),
  ]);
  const items = rows.map(({ votes, _count, ...rest }) => ({
    ...rest,
    ...voteAggregates(votes, viewerId),
    commentCount: _count.comments,
  }));
  return { items, total, page: safePage, pageSize: safeSize };
}

// intentional-nullable: deleted or missing posts are rendered as absent.
export async function getPostById(id: string, viewerId: string) {
  const row = await postRepo.findById(id);
  if (!row || row.deletedAt) return null;
  const { votes, ...rest } = row;
  return { ...rest, ...voteAggregates(votes, viewerId) };
}
