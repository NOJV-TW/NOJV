import { prisma } from "../client";
import type { Prisma, SubmissionFeedbackAction } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

// Exactly one context id is set — mirrors the `SubmissionFeedback`
// CHECK constraint that exactly one of the two columns is non-null.
export type SubmissionFeedbackContext =
  | { courseAssessmentId: string; examId?: undefined }
  | { examId: string; courseAssessmentId?: undefined };

export type SubmissionFeedbackUpsertData = SubmissionFeedbackContext & {
  studentUserId: string;
  problemId: string;
  comment: string;
  authorUserId: string | null;
};

export interface SubmissionFeedbackAuditCreateData {
  feedbackId: string | null;
  studentUserId: string;
  problemId: string;
  courseAssessmentId: string | null;
  examId: string | null;
  action: SubmissionFeedbackAction;
  oldComment: string | null;
  newComment: string | null;
  changedByUserId: string | null;
}

const feedbackInclude = {
  student: { select: { id: true, username: true, name: true } },
  problem: { select: { id: true, title: true } },
} satisfies Prisma.SubmissionFeedbackInclude;

function contextWhere(context: SubmissionFeedbackContext): Prisma.SubmissionFeedbackWhereInput {
  return context.courseAssessmentId !== undefined
    ? { courseAssessmentId: context.courseAssessmentId }
    : { examId: context.examId };
}

export const submissionFeedbackRepo = {
  upsert(tx: TxClient, data: SubmissionFeedbackUpsertData) {
    const where: Prisma.SubmissionFeedbackWhereUniqueInput =
      data.courseAssessmentId !== undefined
        ? {
            courseAssessmentId_problemId_studentUserId: {
              courseAssessmentId: data.courseAssessmentId,
              problemId: data.problemId,
              studentUserId: data.studentUserId,
            },
          }
        : {
            examId_problemId_studentUserId: {
              examId: data.examId,
              problemId: data.problemId,
              studentUserId: data.studentUserId,
            },
          };
    return tx.submissionFeedback.upsert({
      where,
      create: {
        studentUserId: data.studentUserId,
        problemId: data.problemId,
        courseAssessmentId: data.courseAssessmentId ?? null,
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

  findForStudentInContext(studentUserId: string, context: SubmissionFeedbackContext) {
    return prisma.submissionFeedback.findMany({
      where: { studentUserId, ...contextWhere(context) },
      orderBy: { createdAt: "desc" },
      include: feedbackInclude,
    });
  },

  findById(id: string) {
    return prisma.submissionFeedback.findUnique({ where: { id } });
  },

  deleteById(tx: TxClient, id: string) {
    return tx.submissionFeedback.delete({ where: { id } });
  },

  findExistingForUpsert(tx: TxClient, data: SubmissionFeedbackUpsertData) {
    const where: Prisma.SubmissionFeedbackWhereUniqueInput =
      data.courseAssessmentId !== undefined
        ? {
            courseAssessmentId_problemId_studentUserId: {
              courseAssessmentId: data.courseAssessmentId,
              problemId: data.problemId,
              studentUserId: data.studentUserId,
            },
          }
        : {
            examId_problemId_studentUserId: {
              examId: data.examId,
              problemId: data.problemId,
              studentUserId: data.studentUserId,
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
