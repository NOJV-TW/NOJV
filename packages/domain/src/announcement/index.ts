import { announcementRepo } from "@nojv/db";

export function listAllAnnouncements() {
  return announcementRepo.listAll();
}

export async function createAnnouncement(data: {
  title: string;
  content: string;
  pinned: boolean;
  published: boolean;
}) {
  return announcementRepo.create(data);
}

export async function updateAnnouncement(
  id: string,
  data: { title: string; content: string; pinned: boolean; published: boolean }
) {
  return announcementRepo.update(id, data);
}

export async function deleteAnnouncement(id: string) {
  return announcementRepo.delete(id);
}

export async function toggleAnnouncementPin(id: string) {
  const announcement = await announcementRepo.findPinnedStatus(id);
  if (!announcement) return null;
  return announcementRepo.update(id, { pinned: !announcement.pinned });
}

export async function toggleAnnouncementPublish(id: string) {
  const announcement = await announcementRepo.findPublishedStatus(id);
  if (!announcement) return null;
  return announcementRepo.update(id, { published: !announcement.published });
}
