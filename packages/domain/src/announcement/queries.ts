import { announcementRepo } from "@nojv/db";
import type { AnnouncementAudience, PlatformRole } from "@nojv/core";

export function listAllAnnouncements() {
  return announcementRepo.listAll();
}

/**
 * Thin wrapper around `announcementRepo.findById`. Used by the course page
 * actions to verify the announcement actually belongs to the current
 * course before mutating it (i.e. forbid moving an announcement between
 * courses through the update/toggle/delete endpoints).
 */
export function getAnnouncementById(id: string) {
  return announcementRepo.findById(id);
}

interface ActorRoleHint {
  platformRole: PlatformRole;
}

/**
 * Resolve which audiences the given actor is allowed to see in public lists.
 * Anonymous viewers are treated as students. Admin routes call
 * `listAllAnnouncements` directly and bypass this filter.
 */
function audiencesVisibleTo(actor: ActorRoleHint | null | undefined): AnnouncementAudience[] {
  if (actor?.platformRole === "teacher" || actor?.platformRole === "admin") {
    return ["all", "students", "teachers"];
  }
  return ["all", "students"];
}

export function listPublicAnnouncements(actor: ActorRoleHint | null | undefined, take = 20) {
  return announcementRepo.listPublished(take, audiencesVisibleTo(actor));
}

export function listPublicAnnouncementsForCourse(
  courseId: string,
  actor: ActorRoleHint | null | undefined,
  take: number,
) {
  return announcementRepo.listRecentForCourse(courseId, take, audiencesVisibleTo(actor));
}
