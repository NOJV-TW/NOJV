import { prisma, type Prisma } from "@nojv/db";
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";

export const load: PageServerLoad = async ({ url }) => {
  const search = url.searchParams.get("search") ?? "";
  const roleFilter = url.searchParams.get("role") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const take = 50;
  const skip = (page - 1) * take;

  const where: Prisma.UserWhereInput = {};

  if (search) {
    where.OR = [
      { username: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } }
    ];
  }

  if (roleFilter === "admin" || roleFilter === "teacher" || roleFilter === "student") {
    where.platformRole = roleFilter;
  }

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        platformRole: true,
        disabled: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take,
      skip
    }),
    prisma.user.count({ where })
  ]);

  return {
    users,
    totalCount,
    page,
    totalPages: Math.max(1, Math.ceil(totalCount / take)),
    search,
    roleFilter
  };
};

export const actions = {
  updateRole: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const userId = formData.get("userId") as string;
    const role = formData.get("role") as string;

    if (!userId || !["admin", "teacher", "student"].includes(role)) {
      return fail(400, { error: "Invalid input." });
    }

    if (userId === actor.userId) {
      return fail(400, { error: "Cannot change your own role." });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { platformRole: role as "admin" | "teacher" | "student" }
    });

    return { success: true };
  },

  toggleDisabled: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const userId = formData.get("userId") as string;

    if (!userId) {
      return fail(400, { error: "Invalid input." });
    }

    if (userId === actor.userId) {
      return fail(400, { error: "Cannot disable yourself." });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { disabled: true }
    });
    if (!user) return fail(404, { error: "User not found." });

    await prisma.user.update({
      where: { id: userId },
      data: { disabled: !user.disabled }
    });

    return { success: true };
  }
} satisfies Actions;
