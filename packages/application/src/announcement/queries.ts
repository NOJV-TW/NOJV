import { announcementRepo } from "@nojv/db";
import { announcementAudiences } from "@nojv/core";
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

const AUDIENCE_READER_ROLES: Record<AnnouncementAudience, readonly PlatformRole[]> = {
  all: ["admin", "teacher", "student"],
  students: ["admin", "teacher", "student"],
  teachers: ["admin", "teacher"],
};

export function platformRolesForAudience(
  audience: AnnouncementAudience,
): readonly PlatformRole[] {
  return AUDIENCE_READER_ROLES[audience];
}

function audiencesVisibleTo(actor: ActorRoleHint | null | undefined): AnnouncementAudience[] {
  const role = actor?.platformRole ?? "student";
  return announcementAudiences.filter((audience) =>
    AUDIENCE_READER_ROLES[audience].includes(role),
  );
}

export function listPublicAnnouncements(actor: ActorRoleHint | null | undefined) {
  return announcementRepo.listPublished(audiencesVisibleTo(actor));
}

export function listPublicAnnouncementsForCourse(
  courseId: string,
  actor: ActorRoleHint | null | undefined,
  take: number,
) {
  return announcementRepo.listRecentForCourse(courseId, take, audiencesVisibleTo(actor));
}
