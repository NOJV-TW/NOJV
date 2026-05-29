import { prisma } from "../client";
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
            status: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
  },

  removeFromCourse(courseId: string, userId: string) {
    return prisma.courseMembership.update({
      where: { courseId_userId: { courseId, userId } },
      data: {
        status: "removed",
        removedAt: new Date(),
      },
    });
  },

  updateRole(courseId: string, userId: string, role: CourseRole) {
    return prisma.courseMembership.update({
      where: { courseId_userId: { courseId, userId } },
      data: { role },
    });
  },
};
