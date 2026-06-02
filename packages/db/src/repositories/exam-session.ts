import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const examSessionRepo = {
  findActiveForUser(userId: string) {
    return prisma.activeExamSession.findFirst({
      where: { userId, endedAt: null },
    });
  },

  findAllActiveForExam(examId: string) {
    return prisma.activeExamSession.findMany({
      where: { examId, endedAt: null },
    });
  },

  findAllActiveForExamWithUser(examId: string) {
    return prisma.activeExamSession.findMany({
      where: { examId, endedAt: null },
      select: {
        userId: true,
        startedAt: true,
        user: { select: { name: true, displayUsername: true, email: true } },
      },
      orderBy: { startedAt: "asc" },
    });
  },

  async startSession({ userId, examId }: { userId: string; examId: string }) {
    const existing = await prisma.activeExamSession.findUnique({
      where: { userId_examId: { userId, examId } },
    });

    if (existing?.endedAt === null) {
      return existing;
    }

    const now = new Date();
    if (existing) {
      return prisma.activeExamSession.update({
        where: { id: existing.id },
        data: {
          startedAt: now,
          endedAt: null,
          releaseReason: null,
          lastHeartbeatAt: now,
        },
      });
    }

    return prisma.activeExamSession.create({
      data: {
        userId,
        examId,
        startedAt: now,
        lastHeartbeatAt: now,
      },
    });
  },

  async endSession({
    sessionId,
    reason,
  }: {
    sessionId: string;
    reason: "submitted" | "time_up" | "released_by_instructor";
  }) {
    return prisma.activeExamSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        releaseReason: reason,
      },
    });
  },

  updateHeartbeat(sessionId: string) {
    return prisma.activeExamSession.update({
      where: { id: sessionId },
      data: { lastHeartbeatAt: new Date() },
    });
  },

  recordEvent({
    sessionId,
    eventType,
    metadata,
  }: {
    sessionId: string;
    eventType: "enter" | "leave" | "visibility_lost" | "release" | "auto_close" | "heartbeat";
    metadata?: Prisma.InputJsonValue | null;
  }) {
    return prisma.examSessionEvent.create({
      data: {
        sessionId,
        eventType,
        ...(metadata === undefined || metadata === null ? {} : { metadata }),
      },
    });
  },

  listEventsForSession(sessionId: string) {
    return prisma.examSessionEvent.findMany({
      where: { sessionId },
      orderBy: { occurredAt: "asc" },
    });
  },

  findLatestEventOfType(
    sessionId: string,
    eventType: "enter" | "leave" | "visibility_lost" | "release" | "auto_close" | "heartbeat",
  ) {
    return prisma.examSessionEvent.findFirst({
      where: { sessionId, eventType },
      orderBy: { occurredAt: "desc" },
    });
  },

  withTx(tx: TxClient) {
    return {
      findActiveForUser(userId: string) {
        return tx.activeExamSession.findFirst({
          where: { userId, endedAt: null },
        });
      },

      findByUserAndExam(userId: string, examId: string) {
        return tx.activeExamSession.findUnique({
          where: { userId_examId: { userId, examId } },
        });
      },

      findAllActiveForExam(examId: string) {
        return tx.activeExamSession.findMany({
          where: { examId, endedAt: null },
        });
      },

      create(data: Prisma.ActiveExamSessionUncheckedCreateInput) {
        return tx.activeExamSession.create({ data });
      },

      update(id: string, data: Prisma.ActiveExamSessionUncheckedUpdateInput) {
        return tx.activeExamSession.update({
          where: { id },
          data,
        });
      },

      recordEvent(data: Prisma.ExamSessionEventUncheckedCreateInput) {
        return tx.examSessionEvent.create({ data });
      },

      findLatestEventOfType(
        sessionId: string,
        eventType:
          | "enter"
          | "leave"
          | "visibility_lost"
          | "release"
          | "auto_close"
          | "heartbeat",
      ) {
        return tx.examSessionEvent.findFirst({
          where: { sessionId, eventType },
          orderBy: { occurredAt: "desc" },
        });
      },
    };
  },
};
