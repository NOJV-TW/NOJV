import { announcementRepo } from "@nojv/db";
import type { AnnouncementAudience, PlatformRole } from "@nojv/core";

export function listAllAnnouncements() {
  return announcementRepo.listAll();
}

export function getAnnouncementById(id: string) {
  return announcementRepo.findById(id);
}

interface ActorRoleHint {
  platformRole: PlatformRole;
}

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
