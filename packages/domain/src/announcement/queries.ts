import { announcementRepo } from "@nojv/db";
import type { AnnouncementAudience, PlatformRole } from "@nojv/core";

export function listAllAnnouncements() {
  return announcementRepo.listAll();
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
