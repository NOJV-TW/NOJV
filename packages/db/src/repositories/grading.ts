import { prisma } from "../client";
import type { TransactionClient } from "../transaction";

export const gradingRepo = {
  findAllocation(
    context: { assessmentId: string | null; examId: string | null },
    problemId: string,
  ) {
    if (context.examId)
      return prisma.examProblem.findUnique({
        where: { examId_problemId: { examId: context.examId, problemId } },
        select: { points: true },
      });
    if (context.assessmentId)
      return prisma.assessmentProblem.findUnique({
        where: { assessmentId_problemId: { assessmentId: context.assessmentId, problemId } },
        select: { points: true },
      });
    return Promise.resolve(null);
  },
  async listActivities(type: "assignment" | "exam", ids: string[]) {
    const select = {
      id: true,
      totalPoints: true,
      problems: { select: { problemId: true, points: true } },
    } as const;
    if (type === "exam")
      return (
        await prisma.exam.findMany({
          where: { id: { in: ids } },
          select: { ...select, endsAt: true },
        })
      ).map((a) => ({ ...a, deadline: a.endsAt }));
    return (
      await prisma.assessment.findMany({
        where: { id: { in: ids } },
        select: { ...select, closesAt: true },
      })
    ).map((a) => ({ ...a, deadline: a.closesAt }));
  },
  async listDetachedProblemIds(type: "assignment" | "exam", id: string) {
    const query = { where: { id }, select: { detachedProblemIds: true } } as const;
    const activity =
      type === "exam"
        ? await prisma.exam.findUniqueOrThrow(query)
        : await prisma.assessment.findUniqueOrThrow(query);
    return activity.detachedProblemIds;
  },
  async persistExamScore(
    tx: TransactionClient,
    input: {
      id: string;
      examId: string;
      version: number;
      gradingRevision: number;
      score: number;
      subtaskScores: Record<string, number>;
    },
  ) {
    await tx.$queryRaw`SELECT id FROM "Exam" WHERE id = ${input.examId} FOR UPDATE`;
    const exam = await tx.exam.findUniqueOrThrow({
      where: { id: input.examId },
      select: { gradingRevision: true },
    });
    if (exam.gradingRevision !== input.gradingRevision) return false;
    const result = await tx.participation.updateMany({
      where: { id: input.id, version: input.version },
      data: {
        score: input.score,
        subtaskScores: input.subtaskScores,
        gradingRevision: input.gradingRevision,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  },
  countPendingExam(examId: string, gradingRevision: number) {
    return prisma.participation.count({
      where: { type: "exam", examId, gradingRevision: { lt: gradingRevision } },
    });
  },
};
