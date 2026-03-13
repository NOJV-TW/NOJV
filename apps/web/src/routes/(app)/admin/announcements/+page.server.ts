import { prisma } from "@nojv/db";
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";

export const load: PageServerLoad = async () => {
  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" }
  });

  return { announcements };
};

export const actions = {
  create: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const title = (formData.get("title") as string)?.trim();
    const content = (formData.get("content") as string)?.trim();
    const pinned = formData.get("pinned") === "on";
    const published = formData.get("published") === "on";

    if (!title || !content) {
      return fail(400, { error: "Title and content are required." });
    }

    await prisma.announcement.create({
      data: { title, content, pinned, published }
    });

    return { success: true };
  },

  update: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const id = formData.get("id") as string;
    const title = (formData.get("title") as string)?.trim();
    const content = (formData.get("content") as string)?.trim();
    const pinned = formData.get("pinned") === "on";
    const published = formData.get("published") === "on";

    if (!id || !title || !content) {
      return fail(400, { error: "ID, title, and content are required." });
    }

    await prisma.announcement.update({
      where: { id },
      data: { title, content, pinned, published }
    });

    return { success: true };
  },

  delete: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const id = formData.get("id") as string;

    if (!id) return fail(400, { error: "ID is required." });

    await prisma.announcement.delete({ where: { id } });

    return { success: true };
  },

  togglePin: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const id = formData.get("id") as string;

    if (!id) return fail(400, { error: "ID is required." });

    const announcement = await prisma.announcement.findUnique({ where: { id }, select: { pinned: true } });
    if (!announcement) return fail(404, { error: "Not found." });

    await prisma.announcement.update({
      where: { id },
      data: { pinned: !announcement.pinned }
    });

    return { success: true };
  },

  togglePublish: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const id = formData.get("id") as string;

    if (!id) return fail(400, { error: "ID is required." });

    const announcement = await prisma.announcement.findUnique({ where: { id }, select: { published: true } });
    if (!announcement) return fail(404, { error: "Not found." });

    await prisma.announcement.update({
      where: { id },
      data: { published: !announcement.published }
    });

    return { success: true };
  }
} satisfies Actions;
