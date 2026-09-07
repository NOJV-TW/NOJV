import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import { canManageCourse, canManageMembers, courseDomain } from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { classifyRequestError } from "$lib/server/shared/handle-action-error";
import { withAction } from "$lib/server/shared/action-handlers";
import { m } from "$lib/paraglide/messages.js";
import type { FormMessage } from "$lib/types/form-message";

const {
  listMembersForCourse,
  bulkAddByHandle,
  changeMemberRole,
  removeMember,
  parseHandleInput,
} = courseDomain;

const HANDLE_BLOCK_MAX = 16_000;

const bulkAddSchema = z.object({
  handles: z.string().trim().min(1).max(HANDLE_BLOCK_MAX),
  role: z.enum(["student", "ta"]),
});

const changeRoleSchema = z.object({
  membershipId: z.string().trim().min(1),
  role: z.enum(["student", "ta", "teacher"]),
});

const removeSchema = z.object({
  membershipId: z.string().trim().min(1),
});

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { course, isManager } = parent;

  const [members, bulkAddForm] = await Promise.all([
    listMembersForCourse(course.id),
    superValidate({ handles: "", role: "student" as const }, zod4(bulkAddSchema), {
      errors: false,
    }),
  ]);

  const visibleMembers = members
    .filter((member) => member.status === "active")
    .filter((member) => isManager || !member.isPending)
    .filter((member) => member.userId !== actor.userId || member.role !== "teacher")
    .map((member) => ({
      membershipId: member.membershipId,
      userId: member.userId,
      name: member.name,
      username: member.username,
      image: member.image,
      email: isManager ? member.email : null,
      role: member.role,
      isPending: member.isPending,
      joinedAt: member.joinedAt,
    }));

  return {
    members: visibleMembers,
    bulkAddForm,
  };
});

export const actions = {
  bulkAdd: withAction(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate(event, zod4(bulkAddSchema));

    try {
      const role = await getCoursePermissionRole(event.params.courseId, actor);
      if (!canManageCourse(role)) {
        return message<FormMessage>(
          form,
          { kind: "error", text: "Forbidden" },
          { status: 403 },
        );
      }
      if (!form.valid) return fail(400, { form });

      const handles = parseHandleInput(form.data.handles);
      if (handles.length === 0) {
        return message<FormMessage>(
          form,
          { kind: "error", text: "No valid handles in input." },
          { status: 400 },
        );
      }

      const result = await bulkAddByHandle(actor, event.params.courseId, {
        handles,
        role: form.data.role,
      });
      return message<FormMessage>(form, {
        kind: "success",
        text: m.members_addSuccess({
          added: result.added,
          pending: result.pendingCreated,
          skipped: result.skipped,
        }),
      });
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }
  }),

  changeRole: withAction(async (event) => {
    const actor = requireAuth(event);
    const role = await getCoursePermissionRole(event.params.courseId, actor);
    if (!canManageMembers(role)) {
      return fail(403, { error: "Forbidden" });
    }

    const form = await event.request.formData();
    const parsed = changeRoleSchema.safeParse({
      membershipId: form.get("membershipId"),
      role: form.get("role"),
    });
    if (!parsed.success) {
      return fail(400, { error: "Invalid role change request" });
    }

    await changeMemberRole(
      actor,
      event.params.courseId,
      parsed.data.membershipId,
      parsed.data.role,
    );
    return { success: true };
  }),

  remove: withAction(async (event) => {
    const actor = requireAuth(event);
    const role = await getCoursePermissionRole(event.params.courseId, actor);
    if (!canManageMembers(role)) {
      return fail(403, { error: "Forbidden" });
    }

    const form = await event.request.formData();
    const parsed = removeSchema.safeParse({ membershipId: form.get("membershipId") });
    if (!parsed.success) {
      return fail(400, { error: "Invalid remove request" });
    }

    await removeMember(actor, event.params.courseId, parsed.data.membershipId);
    return { success: true };
  }),
} satisfies Actions;
