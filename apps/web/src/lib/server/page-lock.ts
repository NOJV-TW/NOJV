import { prisma } from "@nojv/db";

export type PageLockedContext =
  | {
      type: "contest";
      contestSlug: string;
      courseSlug: string | null;
    }
  | {
      type: "assessment";
      assessmentSlug: string;
      courseSlug: string;
    };

/**
 * Check if user is currently locked to an active contest or assessment.
 * Returns the locked context if found, null otherwise.
 */
export async function getPageLockedContext(userId: string): Promise<PageLockedContext | null> {
  const now = new Date();

  // Check active contests with pageLockEnabled
  const contest = await prisma.contest.findFirst({
    where: {
      pageLockEnabled: true,
      visibility: "published",
      startsAt: { lte: now },
      endsAt: { gte: now },
      participations: {
        some: { userId, status: "active" }
      }
    },
    select: {
      slug: true,
      course: { select: { slug: true } }
    }
  });

  if (contest) {
    return { type: "contest", contestSlug: contest.slug, courseSlug: contest.course?.slug ?? null };
  }

  // Check active course assessments with pageLockEnabled
  // Assessment is "active" if: pageLockEnabled AND opensAt <= now <= closesAt AND user is enrolled in course
  const assessment = await prisma.courseAssessment.findFirst({
    where: {
      pageLockEnabled: true,
      status: "published",
      opensAt: { lte: now },
      closesAt: { gte: now },
      course: {
        memberships: {
          some: { userId, status: "active" }
        }
      }
    },
    select: {
      slug: true,
      course: { select: { slug: true } }
    }
  });

  if (assessment) {
    return { type: "assessment", assessmentSlug: assessment.slug, courseSlug: assessment.course.slug };
  }

  return null;
}
