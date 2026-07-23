import { fail } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import { auditDomain, userDomain, ForbiddenError } from "@nojv/application";

const {
  listUsersPaginated,
  updateUserRole,
  toggleUserDisabled,
  setUserAdvancedCreation,
  setUserDisabled,
  deleteUser,
} = userDomain;

const userIdsSchema = z.array(z.string().min(1)).min(1).max(500);

function parseUserIds(raw: string): string[] | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = userIdsSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

const PLATFORM_ROLES = ["admin", "teacher", "student"] as const;
type PlatformRole = (typeof PLATFORM_ROLES)[number];

function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const search = url.searchParams.get("search") ?? "";
  const roleFilter = url.searchParams.get("role") ?? "";
  const statusParam = url.searchParams.get("status") ?? "";
  const statusFilter =
    statusParam === "active" || statusParam === "disabled" ? statusParam : undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

  const { users, totalCount, totalPages } = await listUsersPaginated({
    ...(search ? { search } : {}),
    ...(roleFilter ? { roleFilter } : {}),
    ...(statusFilter ? { statusFilter } : {}),
    page,
  });

  return {
    users,
    totalCount,
    page,
    totalPages,
    search,
    roleFilter,
    statusFilter: statusFilter ?? "",
    canManageAdmins: locals.sessionUser?.isSuperAdmin === true,
  };
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

    const isSuperAdmin = event.locals.sessionUser?.isSuperAdmin === true;
    try {
      const updated = await updateUserRole(isSuperAdmin, userId, role);
      await auditDomain.recordAdminAudit({
        actorId: actor.userId,
        actorName: actor.displayName,
        action: "user_role_change",
        targetType: "user",
        targetId: userId,
        summary: `${updated.username ?? updated.name} → ${role}`,
      });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return fail(403, { error: "Only a super admin can manage admin accounts." });
      }
      throw err;
    }
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

    const isSuperAdmin = event.locals.sessionUser?.isSuperAdmin === true;
    try {
      const result = await toggleUserDisabled(isSuperAdmin, userId);
      if (!result) return fail(404, { error: "User not found." });
      await auditDomain.recordAdminAudit({
        actorId: actor.userId,
        actorName: actor.displayName,
        action: result.disabled ? "user_disable" : "user_enable",
        targetType: "user",
        targetId: userId,
        summary: result.username ?? result.name,
      });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return fail(403, { error: "Only a super admin can manage admin accounts." });
      }
      throw err;
    }

    return { success: true };
  }),

  updateAdvancedCreation: withAction(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }
    const formData = await event.request.formData();
    const userId = readString(formData, "userId");
    const allowed = readString(formData, "allowed");

    if (!userId || (allowed !== "true" && allowed !== "false")) {
      return fail(400, { error: "Invalid input." });
    }

    const result = await setUserAdvancedCreation(userId, allowed === "true");
    if (!result) return fail(404, { error: "User not found." });
    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "user_advanced_toggle",
      targetType: "user",
      targetId: userId,
      summary: `${result.username ?? result.name} → ${result.canCreateAdvancedProblems ? "granted" : "revoked"}`,
    });

    return { success: true };
  }),

  deleteUser: withAction(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }
    const userId = readString(await event.request.formData(), "userId");

    if (!userId) {
      return fail(400, { error: "Invalid input." });
    }
    if (userId === actor.userId) {
      return fail(400, { error: "Cannot delete yourself." });
    }

    const isSuperAdmin = event.locals.sessionUser?.isSuperAdmin === true;
    try {
      const result = await deleteUser(isSuperAdmin, userId);
      if (!result) return fail(404, { error: "User not found." });
      await auditDomain.recordAdminAudit({
        actorId: actor.userId,
        actorName: actor.displayName,
        action: "user_delete",
        targetType: "user",
        targetId: userId,
        summary: `${result.name} (${result.mode})`,
      });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return fail(403, { error: "Only a super admin can manage admin accounts." });
      }
      throw err;
    }

    return { success: true };
  }),

  bulkSetDisabled: withAction(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }
    const formData = await event.request.formData();
    const userIds = parseUserIds(readString(formData, "userIds"));
    const disabled = readString(formData, "disabled") === "true";

    if (!userIds) {
      return fail(400, { error: "Invalid input." });
    }

    const isSuperAdmin = event.locals.sessionUser?.isSuperAdmin === true;
    let affected = 0;
    for (const userId of userIds) {
      if (userId === actor.userId) continue;
      try {
        const result = await setUserDisabled(isSuperAdmin, userId, disabled);
        if (!result) continue;
        await auditDomain.recordAdminAudit({
          actorId: actor.userId,
          actorName: actor.displayName,
          action: disabled ? "user_disable" : "user_enable",
          targetType: "user",
          targetId: userId,
          summary: result.username ?? result.name,
        });
        affected += 1;
      } catch (err) {
        if (err instanceof ForbiddenError) continue;
        throw err;
      }
    }

    return { success: true, affected };
  }),

  bulkDelete: withAction(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }
    const userIds = parseUserIds(readString(await event.request.formData(), "userIds"));

    if (!userIds) {
      return fail(400, { error: "Invalid input." });
    }

    const isSuperAdmin = event.locals.sessionUser?.isSuperAdmin === true;
    let affected = 0;
    for (const userId of userIds) {
      if (userId === actor.userId) continue;
      try {
        const result = await deleteUser(isSuperAdmin, userId);
        if (!result) continue;
        await auditDomain.recordAdminAudit({
          actorId: actor.userId,
          actorName: actor.displayName,
          action: "user_delete",
          targetType: "user",
          targetId: userId,
          summary: `${result.name} (${result.mode})`,
        });
        affected += 1;
      } catch (err) {
        if (err instanceof ForbiddenError) continue;
        throw err;
      }
    }

    return { success: true, affected };
  }),
} satisfies Actions;
