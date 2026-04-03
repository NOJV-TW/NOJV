import { assessmentRepo, contestRepo } from "@nojv/db";

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
  const contest = await contestRepo.findPageLockedForUser(userId, now);

  if (contest) {
    return {
      type: "contest",
      contestSlug: contest.slug,
      courseSlug: contest.course?.slug ?? null
    };
  }

  // Check active course assessments with pageLockEnabled
  const assessment = await assessmentRepo.findPageLockedForUser(userId, now);

  if (assessment) {
    return {
      type: "assessment",
      assessmentSlug: assessment.slug,
      courseSlug: assessment.course.slug
    };
  }

  return null;
}
