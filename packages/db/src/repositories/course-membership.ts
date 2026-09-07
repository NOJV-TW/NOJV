import { prisma } from "../client";
import type { TransactionClient } from "../transaction";
import type { CourseRole } from "../../generated/prisma/enums";

export const courseMembershipAdminRepo = {
  listWithUserByCourse(courseId: string) {
    return prisma.courseMembership.findMany({
      where: { courseId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
  },

  removeFromCourse(courseId: string, membershipId: string) {
    return prisma.courseMembership.update({
      where: { id: membershipId, courseId },
      data: {
        status: "removed",
        removedAt: new Date(),
      },
    });
  },

  updateRole(courseId: string, membershipId: string, role: CourseRole) {
    return prisma.courseMembership.update({
      where: { id: membershipId, courseId },
      data: { role },
    });
  },

  withTx(tx: TransactionClient) {
    return {
      removeFromCourse(courseId: string, membershipId: string) {
        return tx.courseMembership.update({
          where: { id: membershipId, courseId },
          data: { status: "removed", removedAt: new Date() },
        });
      },

      updateRole(courseId: string, membershipId: string, role: CourseRole) {
        return tx.courseMembership.update({
          where: { id: membershipId, courseId },
          data: { role },
        });
      },
    };
  },
};
