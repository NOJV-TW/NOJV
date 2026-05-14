import { prisma } from "../client";
import type {
  OverrideContextType,
  Prisma,
  ScoreOverrideAction,
} from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export interface ScoreOverrideCompositeKey {
  userId: string;
  problemId: string;
  contextType: OverrideContextType;
  contextId: string;
}

export interface ScoreOverrideCreateData {
  userId: string;
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
  userId: string;
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
  findUnique(key: ScoreOverrideCompositeKey) {
    return prisma.scoreOverride.findUnique({
      where: {
        userId_problemId_contextType_contextId: {
          userId: key.userId,
          problemId: key.problemId,
          contextType: key.contextType,
          contextId: key.contextId,
        },
      },
    });
  },

  findById(id: string) {
    return prisma.scoreOverride.findUnique({ where: { id } });
  },

  listByContext(contextType: OverrideContextType, contextId: string) {
    return prisma.scoreOverride.findMany({
      where: { contextType, contextId },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, username: true, name: true } },
        problem: { select: { id: true, title: true } },
      },
    });
  },

  // Bulk variant used by getOverridesForContext — returns every
  // override row in the given (contextType, contextId) scope keyed by
  // `${userId}::${problemId}` composite.
  findAllByContext(contextType: OverrideContextType, contextId: string) {
    return prisma.scoreOverride.findMany({
      where: { contextType, contextId },
      select: {
        userId: true,
        problemId: true,
        overrideScore: true,
      },
    });
  },

  create(tx: TxClient, data: ScoreOverrideCreateData) {
    const payload: Prisma.ScoreOverrideUncheckedCreateInput = {
      userId: data.userId,
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
