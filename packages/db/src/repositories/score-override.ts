import { prisma } from "../client";
import type {
  OverrideContextType,
  Prisma,
  ScoreOverrideAction,
} from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export type ScoreOverrideCompositeKey = (
  | { userId: string; courseMembershipId?: never }
  | { courseMembershipId: string; userId?: never }
) & {
  problemId: string;
  contextType: OverrideContextType;
  contextId: string;
};

export interface ScoreOverrideCreateData {
  userId: string | null;
  courseMembershipId: string | null;
  problemId: string;
  contextType: OverrideContextType;
  contextId: string;
  overrideScore: number;
  reason: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
}

export interface ScoreOverrideUpdateData {
  overrideScore?: number;
  reason?: string;
  updatedByUserId: string | null;
}

export interface ScoreOverrideAuditCreateData {
  overrideId: string | null;
  userId: string | null;
  courseMembershipId?: string | null;
  sourceMembershipId?: string | null;
  problemId: string;
  contextType: OverrideContextType;
  contextId: string;
  action: ScoreOverrideAction;
  oldScore: number | null;
  newScore: number | null;
  oldReason: string | null;
  newReason: string | null;
  changedByUserId: string | null;
}

export const scoreOverrideRepo = {
  findCourseStudent(tx: TxClient, courseId: string, courseMembershipId: string) {
    return tx.courseMembership.findFirst({
      where: { id: courseMembershipId, courseId, role: "student", status: "active" },
    });
  },

  async findForExamUser(examId: string, userId: string) {
    const rows = await prisma.scoreOverride.findMany({
      where: {
        contextType: "exam",
        contextId: examId,
        membership: { userId, course: { exams: { some: { id: examId } } } },
      },
      select: { problemId: true, overrideScore: true },
    });
    return rows.map((row) => ({ ...row, userId }));
  },

  findUnique(key: ScoreOverrideCompositeKey) {
    return prisma.scoreOverride.findUnique({
      where:
        key.courseMembershipId !== undefined
          ? {
              courseMembershipId_problemId_contextType_contextId: {
                courseMembershipId: key.courseMembershipId,
                problemId: key.problemId,
                contextType: key.contextType,
                contextId: key.contextId,
              },
            }
          : {
              userId_problemId_contextType_contextId: {
                userId: key.userId,
                problemId: key.problemId,
                contextType: key.contextType,
                contextId: key.contextId,
              },
            },
    });
  },

  findById(id: string, tx?: TxClient) {
    return (tx ?? prisma).scoreOverride.findUnique({ where: { id } });
  },

  listByContext(contextType: OverrideContextType, contextId: string) {
    return prisma.scoreOverride.findMany({
      where: { contextType, contextId },
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
        user: { select: { id: true, username: true, name: true } },
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
        contextType,
        contextId: { in: contextIds },
        membership: {
          role: "student",
          status: "active",
          ...(userId === undefined ? {} : { userId }),
        },
      },
      select: {
        contextId: true,
        courseMembershipId: true,
        problemId: true,
        overrideScore: true,
        membership: { select: { userId: true } },
      },
    });
  },

  findAllByContext(contextType: OverrideContextType, contextId: string) {
    return prisma.scoreOverride.findMany({
      where: { contextType, contextId },
      select: {
        userId: true,
        courseMembershipId: true,
        problemId: true,
        overrideScore: true,
      },
    });
  },

  create(tx: TxClient, data: ScoreOverrideCreateData) {
    const payload: Prisma.ScoreOverrideUncheckedCreateInput = {
      userId: data.userId,
      courseMembershipId: data.courseMembershipId,
      problemId: data.problemId,
      contextType: data.contextType,
      contextId: data.contextId,
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
        userId: data.userId,
        courseMembershipId: data.courseMembershipId ?? null,
        sourceMembershipId: data.sourceMembershipId ?? null,
        problemId: data.problemId,
        contextType: data.contextType,
        contextId: data.contextId,
        action: data.action,
        oldScore: data.oldScore,
        newScore: data.newScore,
        oldReason: data.oldReason,
        newReason: data.newReason,
        changedByUserId: data.changedByUserId,
      },
    });
  },

  listForContext(contextType: OverrideContextType, contextId: string, limit = 100) {
    return prisma.scoreOverrideAuditLog.findMany({
      where: { contextType, contextId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        changedBy: { select: { id: true, username: true, name: true } },
      },
    });
  },
};
