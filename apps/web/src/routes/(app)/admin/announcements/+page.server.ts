import { fail } from "@sveltejs/kit";
import { DEFAULT_LOCALE, announcementAudienceSchema } from "@nojv/core";
import type { AnnouncementAudience } from "@nojv/core";
import type { Actions, PageServerLoad } from "./$types";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { readCheckbox, readString } from "$lib/server/shared/form-utils";
import { announcementDomain } from "@nojv/domain";

function readAudience(formData: FormData): AnnouncementAudience {
  const raw = formData.get("audience");
  const parsed = announcementAudienceSchema.safeParse(
    typeof raw === "string" ? raw : undefined,
  );
  return parsed.success ? parsed.data : "all";
}

function readExpiresAt(formData: FormData): Date | null {
  const raw = formData.get("expiresAt");
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const {
  listAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementPin,
  toggleAnnouncementPublish,
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
  return {
    announcements: announcements.map((a) => {
      const localized = pickTranslation(a.translations);
      return {
        id: a.id,
        title: localized.title,
        content: localized.content,
        pinned: a.pinned,
        published: a.status === "published",
        audience: a.audience,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
    }),
  };
};

export const actions = {
  create: withRateLimit(async (event) => {
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
      published: readCheckbox(formData, "published"),
      audience: readAudience(formData),
      expiresAt: readExpiresAt(formData),
    });

    return { success: true };
  }),

  update: withRateLimit(async (event) => {
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
      published: readCheckbox(formData, "published"),
      audience: readAudience(formData),
      expiresAt: readExpiresAt(formData),
    });

    return { success: true };
  }),

  delete: withRateLimit(async (event) => {
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await deleteAnnouncement(id);
    return { success: true };
  }),

  togglePin: withRateLimit(async (event) => {
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const result = await toggleAnnouncementPin(id);
    if (!result) return fail(404, { error: "Not found." });

    return { success: true };
  }),

  togglePublish: withRateLimit(async (event) => {
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const result = await toggleAnnouncementPublish(id);
    if (!result) return fail(404, { error: "Not found." });

    return { success: true };
  }),
} satisfies Actions;
