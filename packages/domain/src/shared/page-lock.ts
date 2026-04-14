import { contestRepo } from "@nojv/db";

/**
 * Page-lock context for a user. Only contests can page-lock now —
 * homework assessments no longer have a page-lock setting (that was an
 * exam-only concern that lives on Contest).
 */
export interface PageLockedContext {
  type: "contest";
  contestSlug: string;
}

/**
 * Check if user is currently locked to an active contest. Returns the
 * locked context if found, null otherwise.
 */
export async function getPageLockedContext(userId: string): Promise<PageLockedContext | null> {
  const now = new Date();

  const contest = await contestRepo.findPageLockedForUser(userId, now);

  if (contest) {
    return {
      type: "contest",
      contestSlug: contest.slug
    };
  }

  return null;
}
