import { fail } from "@sveltejs/kit";
import { DEFAULT_LOCALE } from "@nojv/core";
import type { Actions, PageServerLoad } from "./$types";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { readCheckbox, readString } from "$lib/server/shared/form-utils";
import { announcementDomain } from "@nojv/domain";

const {
  listAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementPin,
  toggleAnnouncementPublish
} = announcementDomain;

interface AnnouncementTranslationRow {
  locale: string;
  title: string;
  content: string;
}

/** Pick the default-locale translation, falling back to the first one. */
function pickTranslation(translations: AnnouncementTranslationRow[] | undefined) {
  if (!translations || translations.length === 0) {
    return { title: "", content: "" };
  }
  const localized = translations.find((t) => t.locale === DEFAULT_LOCALE) ?? translations[0];
  return localized ?? { title: "", content: "" };
}

export const load: PageServerLoad = async () => {
  const announcements = await listAllAnnouncements();
  // Title + content moved to AnnouncementTranslation in the Phase 1
  // redesign. Project them flat for the admin list view so the existing
  // template doesn't need to know about the translation table.
  return {
    announcements: announcements.map((a) => {
      const localized = pickTranslation(a.translations);
      return {
        id: a.id,
        title: localized.title,
        content: localized.content,
        pinned: a.pinned,
        published: a.status === "published",
        createdAt: a.createdAt,
        updatedAt: a.updatedAt
      };
    })
  };
};

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
