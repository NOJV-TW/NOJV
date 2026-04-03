import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { announcementDomain } from "@nojv/domain";

const {
  listAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementPin,
  toggleAnnouncementPublish
} = announcementDomain;

export const load: PageServerLoad = async () => {
  const announcements = await listAllAnnouncements();

  return { announcements };
};

export const actions = {
  create: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const title = (formData.get("title") as string | null)?.trim();
    const content = (formData.get("content") as string | null)?.trim();
    const pinned = formData.get("pinned") === "on";
    const published = formData.get("published") === "on";

    if (!title || !content) {
      return fail(400, { error: "Title and content are required." });
    }

    await createAnnouncement({ title, content, pinned, published });

    return { success: true };
  },

  update: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const id = formData.get("id") as string;
    const title = (formData.get("title") as string | null)?.trim();
    const content = (formData.get("content") as string | null)?.trim();
    const pinned = formData.get("pinned") === "on";
    const published = formData.get("published") === "on";

    if (!id || !title || !content) {
      return fail(400, { error: "ID, title, and content are required." });
    }

    await updateAnnouncement(id, { title, content, pinned, published });

    return { success: true };
  },

  delete: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const id = formData.get("id") as string;

    if (!id) return fail(400, { error: "ID is required." });

    await deleteAnnouncement(id);

    return { success: true };
  },

  togglePin: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const id = formData.get("id") as string;

    if (!id) return fail(400, { error: "ID is required." });

    const result = await toggleAnnouncementPin(id);
    if (!result) return fail(404, { error: "Not found." });

    return { success: true };
  },

  togglePublish: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const id = formData.get("id") as string;

    if (!id) return fail(400, { error: "ID is required." });

    const result = await toggleAnnouncementPublish(id);
    if (!result) return fail(404, { error: "Not found." });

    return { success: true };
  }
} satisfies Actions;
