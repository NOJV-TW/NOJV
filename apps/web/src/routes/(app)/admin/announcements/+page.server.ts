import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
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

export const load: PageServerLoad = async () => ({
  announcements: await listAllAnnouncements()
});

/** Read a trimmed string field from FormData; returns "" for missing or non-string values. */
function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readCheckbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

export const actions = {
  create: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const formData = await event.request.formData();
    const title = readString(formData, "title");
    const content = readString(formData, "content");

    if (!title || !content) {
      return fail(400, { error: "Title and content are required." });
    }

    await createAnnouncement({
      title,
      content,
      pinned: readCheckbox(formData, "pinned"),
      published: readCheckbox(formData, "published")
    });

    return { success: true };
  },

  update: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const formData = await event.request.formData();
    const id = readString(formData, "id");
    const title = readString(formData, "title");
    const content = readString(formData, "content");

    if (!id || !title || !content) {
      return fail(400, { error: "ID, title, and content are required." });
    }

    await updateAnnouncement(id, {
      title,
      content,
      pinned: readCheckbox(formData, "pinned"),
      published: readCheckbox(formData, "published")
    });

    return { success: true };
  },

  delete: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await deleteAnnouncement(id);
    return { success: true };
  },

  togglePin: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const result = await toggleAnnouncementPin(id);
    if (!result) return fail(404, { error: "Not found." });

    return { success: true };
  },

  togglePublish: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const result = await toggleAnnouncementPublish(id);
    if (!result) return fail(404, { error: "Not found." });

    return { success: true };
  }
} satisfies Actions;
