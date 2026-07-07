import { error, fail, type RequestEvent } from "@sveltejs/kit";
import { DEFAULT_LOCALE, announcementAudienceSchema } from "@nojv/core";
import type { AnnouncementAudience } from "@nojv/core";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { readCheckbox, readString } from "$lib/server/shared/form-utils";
import { announcementDomain, auditDomain } from "@nojv/application";

function requireAdmin(event: RequestEvent) {
  const actor = requireAuth(event);
  if (actor.platformRole !== "admin") {
    error(403, "Admin access required.");
  }
  return actor;
}

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
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        authorName: a.createdBy?.name ?? "NOJV",
      };
    }),
  };
};

export const actions = {
  create: withAction(async (event) => {
    const actor = requireAdmin(event);
    const formData = await event.request.formData();
    const title = readString(formData, "title");
    const content = readString(formData, "content");

    if (!title || !content) {
      return fail(400, { error: "Title and content are required." });
    }

    const created = await createAnnouncement({
      title,
      content,
      pinned: readCheckbox(formData, "pinned"),
      published: readCheckbox(formData, "published"),
      audience: readAudience(formData),
      expiresAt: readExpiresAt(formData),
      createdByUserId: actor.userId,
    });

    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "announcement_create",
      targetType: "announcement",
      targetId: created.id,
      summary: title,
    });

    return { success: true };
  }),

  update: withAction(async (event) => {
    requireAdmin(event);
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

  delete: withAction(async (event) => {
    const actor = requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await deleteAnnouncement(id);
    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "announcement_delete",
      targetType: "announcement",
      targetId: id,
      summary: id,
    });
    return { success: true };
  }),

  togglePin: withAction(async (event) => {
    requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const result = await toggleAnnouncementPin(id);
    if (!result) return fail(404, { error: "Not found." });

    return { success: true };
  }),

  togglePublish: withAction(async (event) => {
    requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const result = await toggleAnnouncementPublish(id);
    if (!result) return fail(404, { error: "Not found." });

    return { success: true };
  }),
} satisfies Actions;
