import { prisma } from "../client";
import type {
  ClarificationContextType,
  ClarificationState,
  Prisma,
} from "../../generated/prisma/client";

const clarificationInclude = {
  askedBy: { select: { id: true, username: true, name: true } },
  answeredBy: { select: { id: true, username: true, name: true } },
  problem: { select: { id: true, title: true } },
} as const satisfies Prisma.ClarificationInclude;

export type ClarificationRow = Prisma.ClarificationGetPayload<{
  include: typeof clarificationInclude;
}>;

export interface ClarificationCreateInput {
  contextType: ClarificationContextType;
  contextId: string;
  problemId: string | null;
  askedByUserId: string;
  questionText: string;
}

export interface ClarificationAnswerUpdate {
  answerText: string;
  answeredByUserId: string;
  state: ClarificationState;
  answeredAt: Date;
}

export const clarificationRepo = {
  /** Live threads for a context — soft-deleted rows are filtered. */
  listForContext(contextType: ClarificationContextType, contextId: string, since?: Date) {
    return prisma.clarification.findMany({
      where: {
        contextType,
        contextId,
        deletedAt: null,
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: clarificationInclude,
    });
  },

  /**
   * Find by id, including soft-deleted rows. The domain layer translates
   * `deletedAt != null` into NotFoundError so callers cannot distinguish
   * "never existed" from "soft-deleted".
   */
  findById(id: string) {
    return prisma.clarification.findUnique({
      where: { id },
      include: clarificationInclude,
    });
  },

  create(data: ClarificationCreateInput) {
    return prisma.clarification.create({
      data: {
        contextType: data.contextType,
        contextId: data.contextId,
        problemId: data.problemId,
        askedByUserId: data.askedByUserId,
        questionText: data.questionText,
      },
      include: clarificationInclude,
    });
  },

  updateAnswer(id: string, data: ClarificationAnswerUpdate) {
    return prisma.clarification.update({
      where: { id },
      data: {
        answerText: data.answerText,
        answeredByUserId: data.answeredByUserId,
        state: data.state,
        answeredAt: data.answeredAt,
      },
      include: clarificationInclude,
    });
  },

  updateState(id: string, state: ClarificationState) {
    return prisma.clarification.update({
      where: { id },
      data: { state },
      include: clarificationInclude,
    });
  },

  /**
   * Soft-delete by setting `deletedAt`. Idempotency is handled at the
   * domain layer (a re-delete of a tombstoned row surfaces as 404).
   */
  softDelete(id: string, now = new Date()) {
    return prisma.clarification.update({
      where: { id },
      data: { deletedAt: now },
      include: clarificationInclude,
    });
  },

  countInWindow(
    userId: string,
    contextType: ClarificationContextType,
    contextId: string,
    windowStart: Date,
  ) {
    return prisma.clarification.count({
      where: {
        askedByUserId: userId,
        contextType,
        contextId,
        deletedAt: null,
        createdAt: { gte: windowStart },
      },
    });
  },
};
