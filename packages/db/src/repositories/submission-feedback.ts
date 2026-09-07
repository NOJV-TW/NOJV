import { prisma } from "../client";
import type { Prisma, SubmissionFeedbackAction } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export type SubmissionFeedbackContext =
  { assessmentId: string; examId?: undefined } | { examId: string; assessmentId?: undefined };

export type SubmissionFeedbackUpsertData = SubmissionFeedbackContext & {
  courseMembershipId: string;
  problemId: string;
  comment: string;
  authorUserId: string | null;
};

export interface SubmissionFeedbackAuditCreateData {
  feedbackId: string | null;
  studentUserId: string | null;
  courseMembershipId?: string | null;
  sourceMembershipId?: string | null;
  problemId: string;
  assessmentId: string | null;
  examId: string | null;
  action: SubmissionFeedbackAction;
  oldComment: string | null;
  newComment: string | null;
  changedByUserId: string | null;
}

const feedbackInclude = {
  membership: {
    select: {
      id: true,
      userId: true,
      pendingUsername: true,
      user: { select: { id: true, username: true, name: true } },
    },
  },
  problem: { select: { id: true, title: true } },
} satisfies Prisma.SubmissionFeedbackInclude;

function contextWhere(context: SubmissionFeedbackContext): Prisma.SubmissionFeedbackWhereInput {
  return context.assessmentId !== undefined
    ? { assessmentId: context.assessmentId }
    : { examId: context.examId };
}

export const submissionFeedbackRepo = {
  upsert(tx: TxClient, data: SubmissionFeedbackUpsertData) {
    const where: Prisma.SubmissionFeedbackWhereUniqueInput =
      data.assessmentId !== undefined
        ? {
            assessmentId_problemId_courseMembershipId: {
              assessmentId: data.assessmentId,
              problemId: data.problemId,
              courseMembershipId: data.courseMembershipId,
            },
          }
        : {
            examId_problemId_courseMembershipId: {
              examId: data.examId,
              problemId: data.problemId,
              courseMembershipId: data.courseMembershipId,
            },
          };
    return tx.submissionFeedback.upsert({
      where,
      create: {
        courseMembershipId: data.courseMembershipId,
        problemId: data.problemId,
        assessmentId: data.assessmentId ?? null,
        examId: data.examId ?? null,
        comment: data.comment,
        authorUserId: data.authorUserId,
      },
      update: {
        comment: data.comment,
        authorUserId: data.authorUserId,
      },
    });
  },

  findForContext(context: SubmissionFeedbackContext) {
    return prisma.submissionFeedback.findMany({
      where: contextWhere(context),
      orderBy: { createdAt: "desc" },
      include: feedbackInclude,
    });
  },

  findForStudentInContext(userId: string, context: SubmissionFeedbackContext) {
    return prisma.submissionFeedback.findMany({
      where: {
        membership: { userId, role: "student", status: "active" },
        ...contextWhere(context),
      },
      orderBy: { createdAt: "desc" },
      include: feedbackInclude,
    });
  },

  findById(id: string, tx?: TxClient) {
    return (tx ?? prisma).submissionFeedback.findUnique({ where: { id } });
  },

  deleteById(tx: TxClient, id: string) {
    return tx.submissionFeedback.delete({ where: { id } });
  },

  findExistingForUpsert(tx: TxClient, data: SubmissionFeedbackUpsertData) {
    const where: Prisma.SubmissionFeedbackWhereUniqueInput =
      data.assessmentId !== undefined
        ? {
            assessmentId_problemId_courseMembershipId: {
              assessmentId: data.assessmentId,
              problemId: data.problemId,
              courseMembershipId: data.courseMembershipId,
            },
          }
        : {
            examId_problemId_courseMembershipId: {
              examId: data.examId,
              problemId: data.problemId,
              courseMembershipId: data.courseMembershipId,
            },
          };
    return tx.submissionFeedback.findUnique({ where });
  },
};

export const submissionFeedbackAuditLogRepo = {
  create(tx: TxClient, data: SubmissionFeedbackAuditCreateData) {
    return tx.submissionFeedbackAuditLog.create({ data });
  },

  listForFeedback(feedbackId: string, limit = 100) {
    return prisma.submissionFeedbackAuditLog.findMany({
      where: { feedbackId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        changedBy: { select: { id: true, username: true, name: true } },
      },
    });
  },
};
