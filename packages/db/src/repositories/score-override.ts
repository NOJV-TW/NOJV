import { prisma } from "../client";
import type { Prisma, ScoreOverrideAction } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import type { SubmissionFeedbackContext } from "./submission-feedback";

type TxClient = TransactionClient;

export type ScoreOverrideContext = SubmissionFeedbackContext;

export type ScoreOverrideCreateData = ScoreOverrideContext & {
  courseMembershipId: string;
  problemId: string;
  overrideScore: number;
  reason: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
};

export interface ScoreOverrideUpdateData {
  overrideScore?: number;
  reason?: string;
  updatedByUserId: string | null;
}

export interface ScoreOverrideAuditCreateData {
  overrideId: string | null;
  studentUserId: string | null;
  courseMembershipId?: string | null;
  sourceMembershipId?: string | null;
  problemId: string;
  assessmentId: string | null;
  examId: string | null;
  action: ScoreOverrideAction;
  oldScore: number | null;
  newScore: number | null;
  oldReason: string | null;
  newReason: string | null;
  changedByUserId: string | null;
}

function contextWhere(
  context: ScoreOverrideContext,
): { assessmentId: string } | { examId: string } {
  return context.assessmentId !== undefined
    ? { assessmentId: context.assessmentId }
    : { examId: context.examId };
}

export const scoreOverrideRepo = {
  findCourseStudent(tx: TxClient, courseId: string, courseMembershipId: string) {
    return tx.courseMembership.findFirst({
      where: { id: courseMembershipId, courseId, role: "student", status: "active" },
    });
  },

  async findForExamUser(examId: string, userId: string) {
    const rows = await prisma.scoreOverride.findMany({
      where: { examId, membership: { userId } },
      select: { problemId: true, overrideScore: true },
    });
    return rows.map((row) => ({ ...row, userId }));
  },

  findById(id: string, tx?: TxClient) {
    return (tx ?? prisma).scoreOverride.findUnique({ where: { id } });
  },

  listByContext(context: ScoreOverrideContext) {
    return prisma.scoreOverride.findMany({
      where: contextWhere(context),
      orderBy: { createdAt: "desc" },
      include: {
        membership: {
          select: {
            id: true,
            userId: true,
            pendingUsername: true,
            user: { select: { id: true, username: true, name: true } },
          },
        },
        problem: { select: { id: true, title: true } },
      },
    });
  },

  findCourseOverrides(
    contextType: "assignment" | "exam",
    contextIds: string[],
    userId?: string,
  ) {
    return prisma.scoreOverride.findMany({
      where: {
        ...(contextType === "assignment"
          ? { assessmentId: { in: contextIds } }
          : { examId: { in: contextIds } }),
        membership: {
          role: "student",
          status: "active",
          ...(userId === undefined ? {} : { userId }),
        },
      },
      select: {
        courseMembershipId: true,
        problemId: true,
        overrideScore: true,
        membership: { select: { userId: true } },
      },
    });
  },

  findAllByContext(context: ScoreOverrideContext) {
    return prisma.scoreOverride.findMany({
      where: contextWhere(context),
      select: {
        courseMembershipId: true,
        problemId: true,
        overrideScore: true,
      },
    });
  },

  create(tx: TxClient, data: ScoreOverrideCreateData) {
    const payload: Prisma.ScoreOverrideUncheckedCreateInput = {
      courseMembershipId: data.courseMembershipId,
      problemId: data.problemId,
      assessmentId: data.assessmentId ?? null,
      examId: data.examId ?? null,
      overrideScore: data.overrideScore,
      reason: data.reason,
      createdByUserId: data.createdByUserId,
      updatedByUserId: data.updatedByUserId,
    };
    return tx.scoreOverride.create({ data: payload });
  },

  update(tx: TxClient, id: string, data: ScoreOverrideUpdateData) {
    const payload: Prisma.ScoreOverrideUncheckedUpdateInput = {
      updatedByUserId: data.updatedByUserId,
    };
    if (data.overrideScore !== undefined) payload.overrideScore = data.overrideScore;
    if (data.reason !== undefined) payload.reason = data.reason;
    return tx.scoreOverride.update({ where: { id }, data: payload });
  },

  delete(tx: TxClient, id: string) {
    return tx.scoreOverride.delete({ where: { id } });
  },
};

export const scoreOverrideAuditLogRepo = {
  create(tx: TxClient, data: ScoreOverrideAuditCreateData) {
    return tx.scoreOverrideAuditLog.create({
      data: {
        overrideId: data.overrideId,
        studentUserId: data.studentUserId,
        courseMembershipId: data.courseMembershipId ?? null,
        sourceMembershipId: data.sourceMembershipId ?? null,
        problemId: data.problemId,
        assessmentId: data.assessmentId,
        examId: data.examId,
        action: data.action,
        oldScore: data.oldScore,
        newScore: data.newScore,
        oldReason: data.oldReason,
        newReason: data.newReason,
        changedByUserId: data.changedByUserId,
      },
    });
  },

  listForContext(context: ScoreOverrideContext, limit = 100) {
    return prisma.scoreOverrideAuditLog.findMany({
      where: contextWhere(context),
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        changedBy: { select: { id: true, username: true, name: true } },
      },
    });
  },
};
