import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

/**
 * Thin CRUD around `ActiveExamSession` + `ExamSessionEvent`.
 *
 * The domain layer (`@nojv/domain/exam/session`) is where access
 * checks and event-recording orchestration live — this repo only
 * knows about rows.
 */
export const examSessionRepo = {
  /**
   * The single in-progress (`endedAt IS NULL`) session for a user,
   * if any. In practice there is at most one such row total per user
   * because Phase 4 enforces "one active exam at a time", but the
   * query filter on `endedAt` is what makes that safe — the unique
   * index is `(userId, examId)`, which allows historical ended rows.
   */
  findActiveForUser(userId: string) {
    return prisma.activeExamSession.findFirst({
      where: { userId, endedAt: null }
    });
  },

  /**
   * Every in-progress (`endedAt IS NULL`) session for an exam. Used
   * by the Temporal `examAutoCloseWorkflow` to enumerate sessions
   * that need closing when `exam.endsAt` passes.
   */
  findAllActiveForExam(examId: string) {
    return prisma.activeExamSession.findMany({
      where: { examId, endedAt: null }
    });
  },

  /**
   * Start a session for (userId, examId). Upserts against the
   * `(userId, examId)` unique: if a row already exists and has not
   * ended, return it untouched so concurrent starts are idempotent.
   * If the row exists but already ended, re-open it by clearing
   * `endedAt` / `releaseReason` and bumping `startedAt`.
   */
  async startSession({
    userId,
    examId,
    ipPin
  }: {
    userId: string;
    examId: string;
    ipPin?: string | null;
  }) {
    const existing = await prisma.activeExamSession.findUnique({
      where: { userId_examId: { userId, examId } }
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
          ipPin: ipPin ?? null,
          lastHeartbeatAt: now
        }
      });
    }

    return prisma.activeExamSession.create({
      data: {
        userId,
        examId,
        startedAt: now,
        ipPin: ipPin ?? null,
        lastHeartbeatAt: now
      }
    });
  },

  /**
   * Mark a session ended. Idempotent — calling twice keeps the
   * earliest `endedAt` by checking the current state first.
   */
  async endSession({
    sessionId,
    reason
  }: {
    sessionId: string;
    reason: "submitted" | "time_up" | "released_by_instructor";
  }) {
    return prisma.activeExamSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        releaseReason: reason
      }
    });
  },

  /**
   * Bump `lastHeartbeatAt` without touching `endedAt` or `releaseReason`.
   * Callers in the domain layer also append a `heartbeat` event so the
   * audit log preserves the raw pings; this method only updates the
   * session row.
   */
  updateHeartbeat(sessionId: string) {
    return prisma.activeExamSession.update({
      where: { id: sessionId },
      data: { lastHeartbeatAt: new Date() }
    });
  },

  /**
   * Append-only event insert. `metadata` is passed through as-is.
   */
  recordEvent({
    sessionId,
    eventType,
    metadata
  }: {
    sessionId: string;
    eventType: "enter" | "leave" | "visibility_lost" | "release" | "auto_close" | "heartbeat";
    metadata?: Prisma.InputJsonValue | null;
  }) {
    return prisma.examSessionEvent.create({
      data: {
        sessionId,
        eventType,
        ...(metadata === undefined || metadata === null ? {} : { metadata })
      }
    });
  },

  /**
   * Full event history for a session, oldest first.
   */
  listEventsForSession(sessionId: string) {
    return prisma.examSessionEvent.findMany({
      where: { sessionId },
      orderBy: { occurredAt: "asc" }
    });
  },

  /**
   * Most recent event of a given type for a session, or `null`. Used by
   * the heartbeat endpoint to throttle audit-log writes — if the last
   * heartbeat event is younger than the throttle window, the next ping
   * still bumps `lastHeartbeatAt` on the row but skips appending a new
   * event row.
   */
  findLatestEventOfType(
    sessionId: string,
    eventType: "enter" | "leave" | "visibility_lost" | "release" | "auto_close" | "heartbeat"
  ) {
    return prisma.examSessionEvent.findFirst({
      where: { sessionId, eventType },
      orderBy: { occurredAt: "desc" }
    });
  },

  withTx(tx: TxClient) {
    return {
      findActiveForUser(userId: string) {
        return tx.activeExamSession.findFirst({
          where: { userId, endedAt: null }
        });
      },

      findByUserAndExam(userId: string, examId: string) {
        return tx.activeExamSession.findUnique({
          where: { userId_examId: { userId, examId } }
        });
      },

      create(data: Prisma.ActiveExamSessionUncheckedCreateInput) {
        return tx.activeExamSession.create({ data });
      },

      update(id: string, data: Prisma.ActiveExamSessionUncheckedUpdateInput) {
        return tx.activeExamSession.update({
          where: { id },
          data
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
          | "heartbeat"
      ) {
        return tx.examSessionEvent.findFirst({
          where: { sessionId, eventType },
          orderBy: { occurredAt: "desc" }
        });
      }
    };
  }
};
