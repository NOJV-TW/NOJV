import { prisma } from "../client";
import type { TransactionClient } from "../transaction";

const activeStaff = (userId: string) => ({
  userId,
  status: "active" as const,
  role: { in: ["teacher", "ta"] as ("teacher" | "ta")[] },
});

function staffLinks(problemId: string, userId: string, editable: boolean) {
  return {
    problemId,
    course: {
      ...(editable ? { archived: false } : {}),
      memberships: { some: activeStaff(userId) },
    },
  };
}

export const courseProblemRepo = {
  async hasStaffAccess(problemId: string, userId: string, editable = false) {
    return (
      (await prisma.courseProblem.findFirst({
        where: staffLinks(problemId, userId, editable),
        select: { courseId: true },
      })) !== null
    );
  },

  listByCourse(courseId: string) {
    return prisma.courseProblem.findMany({
      where: { courseId },
      include: { problem: true },
      orderBy: [{ createdAt: "asc" }, { problemId: "asc" }],
    });
  },

  withTx(tx: TransactionClient) {
    return {
      add(courseId: string, problemId: string, addedByUserId: string) {
        return tx.courseProblem.upsert({
          where: { courseId_problemId: { courseId, problemId } },
          create: { courseId, problemId, addedByUserId },
          update: {},
        });
      },

      remove(courseId: string, problemId: string) {
        return tx.courseProblem.deleteMany({ where: { courseId, problemId } });
      },

      async lockStaffEditAccess(problemId: string, userId: string) {
        const links = await tx.courseProblem.findMany({
          where: staffLinks(problemId, userId, true),
          select: { courseId: true },
          orderBy: { courseId: "asc" },
        });
        for (const { courseId } of links) {
          await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
        }
        for (const { courseId } of links) {
          await tx.$queryRaw`SELECT id FROM "CourseMembership" WHERE "courseId" = ${courseId} AND "userId" = ${userId} FOR UPDATE`;
        }
        for (const { courseId } of links) {
          await tx.$queryRaw`SELECT "courseId" FROM "CourseProblem" WHERE "courseId" = ${courseId} AND "problemId" = ${problemId} FOR UPDATE`;
        }
        return (
          (await tx.courseProblem.findFirst({
            where: {
              ...staffLinks(problemId, userId, true),
              courseId: { in: links.map(({ courseId }) => courseId) },
            },
            select: { courseId: true },
          })) !== null
        );
      },

      async lockProblem(problemId: string) {
        await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problemId} FOR UPDATE`;
        return tx.problem.findUnique({ where: { id: problemId } });
      },
    };
  },
};
