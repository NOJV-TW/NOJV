import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import { userDomain } from "@nojv/application";

const { listUsersPaginated, updateUserRole, toggleUserDisabled } = userDomain;

const PLATFORM_ROLES = ["admin", "teacher", "student"] as const;
type PlatformRole = (typeof PLATFORM_ROLES)[number];

function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export const load: PageServerLoad = async ({ url }) => {
  const search = url.searchParams.get("search") ?? "";
  const roleFilter = url.searchParams.get("role") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

  const { users, totalCount, totalPages } = await listUsersPaginated({
    ...(search ? { search } : {}),
    ...(roleFilter ? { roleFilter } : {}),
    page,
  });

  return { users, totalCount, page, totalPages, search, roleFilter };
};

export const actions = {
  updateRole: withAction(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }
    const formData = await event.request.formData();
    const userId = readString(formData, "userId");
    const role = readString(formData, "role");

    if (!userId || !isPlatformRole(role)) {
      return fail(400, { error: "Invalid input." });
    }
    if (userId === actor.userId) {
      return fail(400, { error: "Cannot change your own role." });
    }

    await updateUserRole(userId, role);
    return { success: true };
  }),

  toggleDisabled: withAction(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }
    const userId = readString(await event.request.formData(), "userId");

    if (!userId) {
      return fail(400, { error: "Invalid input." });
    }
    if (userId === actor.userId) {
      return fail(400, { error: "Cannot disable yourself." });
    }

    const result = await toggleUserDisabled(userId);
    if (!result) return fail(404, { error: "User not found." });

    return { success: true };
  }),
} satisfies Actions;
