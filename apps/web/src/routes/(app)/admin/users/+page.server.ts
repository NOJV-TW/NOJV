import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { userDomain } from "@nojv/domain";

const { listUsersPaginated, updateUserRole, toggleUserDisabled } = userDomain;

export const load: PageServerLoad = async ({ url }) => {
  const search = url.searchParams.get("search") ?? "";
  const roleFilter = url.searchParams.get("role") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

  const { users, totalCount, totalPages } = await listUsersPaginated({
    ...(search ? { search } : {}),
    ...(roleFilter ? { roleFilter } : {}),
    page
  });

  return {
    users,
    totalCount,
    page,
    totalPages,
    search,
    roleFilter
  };
};

export const actions = {
  updateRole: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

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

    await updateUserRole(userId, role as "admin" | "teacher" | "student");

    return { success: true };
  },

  toggleDisabled: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

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

    const result = await toggleUserDisabled(userId);
    if (!result) return fail(404, { error: "User not found." });

    return { success: true };
  }
} satisfies Actions;
