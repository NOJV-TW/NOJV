import { prisma, type TransactionClient } from "@nojv/db";

import type { CompletedActorContext } from "../actor-context";
import { ForbiddenError, NotFoundError } from "../api-errors";

export interface EnsureUserInput {
  displayName?: string;
  email?: string;
  handle?: string;
  locale?: string;
  platformRole?: "admin" | "student" | "teacher";
}

export interface CreateProblemDefinitionInput {
  authorId?: string;
  difficulty: "easy" | "hard" | "medium";
  memoryLimitMb?: number;
  statement?: string;
  summary: string;
  timeLimitMs?: number;
  title: string;
  visibility?: "private" | "public";
}

export function sanitizeIdentitySegment(value: string) {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "local-user";
}

export function createLocalEmail(userId: string) {
  return `${sanitizeIdentitySegment(userId)}@local.nojv.dev`;
}

export function createLocalDisplayName(userId: string) {
  return `Local ${userId.replaceAll(/[_-]+/g, " ")}`;
}

function createLocalHandle(userId: string) {
  return sanitizeIdentitySegment(userId);
}

export async function ensureUser(
  tx: TransactionClient,
  userId: string,
  input: EnsureUserInput = {}
) {
  const email = input.email ?? createLocalEmail(userId);
  const handle = input.handle ?? createLocalHandle(userId);
  const existing = await tx.user.findFirst({
    where: {
      OR: [{ email }, { handle }, { id: userId }]
    }
  });

  const data = {
    name: input.displayName ?? createLocalDisplayName(userId),
    email,
    handle,
    locale: input.locale ?? "zh-TW",
    platformRole: input.platformRole ?? "student"
  } as const;

  if (existing) {
    return tx.user.update({
      data,
      where: {
        id: existing.id
      }
    });
  }

  return tx.user.create({
    data: {
      ...data,
      id: userId
    }
  });
}

export async function createProblemDefinition(
  tx: TransactionClient,
  problemSlug: string,
  input: CreateProblemDefinitionInput
) {
  const problem = await tx.problem.create({
    data: {
      authorId: input.authorId ?? null,
      defaultTitle: input.title,
      difficulty: input.difficulty,
      id: `problem_${problemSlug}`,
      memoryLimitMb: input.memoryLimitMb ?? 256,
      slug: problemSlug,
      summary: input.summary,
      timeLimitMs: input.timeLimitMs ?? 1_000,
      visibility: input.visibility ?? "public"
    }
  });

  if (input.statement) {
    await tx.problemStatementI18n.create({
      data: {
        bodyMarkdown: input.statement,
        locale: "zh-TW",
        problemId: problem.id,
        title: input.title
      }
    });
  }

  return problem;
}

export async function requireProblem(tx: TransactionClient, problemSlug: string) {
  const problem = await tx.problem.findUnique({
    where: {
      slug: problemSlug
    }
  });

  if (!problem) {
    throw new NotFoundError(`Problem not found: ${problemSlug}`);
  }

  return problem;
}

export function assertCourseProblemAccess(
  problem: { authorId: string | null; visibility: string },
  actor: CompletedActorContext
) {
  if (
    problem.visibility === "private" &&
    actor.platformRole !== "admin" &&
    problem.authorId !== actor.userId
  ) {
    throw new ForbiddenError("Private problems can only be attached by their author or an admin.");
  }
}

export async function requireContest(tx: TransactionClient, contestSlug: string) {
  const contest = await tx.contest.findUnique({
    where: { slug: contestSlug }
  });

  if (!contest) {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  return contest;
}

export async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestSlug: string
) {
  const contest = await requireContest(tx, contestSlug);

  return tx.contestParticipation.upsert({
    create: {
      contestId: contest.id,
      startedAt: new Date(),
      status: "active",
      userId
    },
    update: {
      status: "active"
    },
    where: {
      contestId_userId: {
        contestId: contest.id,
        userId
      }
    }
  });
}

export async function requireCourse(tx: TransactionClient, courseSlug: string) {
  const course = await tx.course.findUnique({
    where: {
      slug: courseSlug
    }
  });

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseSlug}`);
  }

  return course;
}

export async function requireCourseAssessment(
  tx: TransactionClient,
  courseSlug: string,
  assessmentSlug: string
) {
  const course = await requireCourse(tx, courseSlug);
  const assessment = await tx.courseAssessment.findUnique({
    where: {
      courseId_slug: {
        courseId: course.id,
        slug: assessmentSlug
      }
    }
  });

  if (!assessment) {
    throw new NotFoundError(`Assessment not found: ${courseSlug}/${assessmentSlug}`);
  }

  return {
    assessment,
    course
  };
}

export async function getRuntimeStats() {
  const [submissions, workspaceRuns, cheatingSignals, cheatingCases] = await Promise.all([
    prisma.submission.count(),
    prisma.workspaceRun.count(),
    prisma.cheatingSignal.count(),
    prisma.cheatingCase.count()
  ]);

  return {
    cheatingCases,
    cheatingSignals,
    submissions,
    workspaceRuns
  };
}
