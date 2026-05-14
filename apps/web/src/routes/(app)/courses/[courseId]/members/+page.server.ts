import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import { canManageCourse, courseDomain } from "@nojv/domain";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { withRateLimit } from "$lib/server/shared/action-handlers";
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
  userId: z.string().trim().min(1),
  role: z.enum(["student", "ta", "teacher"]),
});

const removeSchema = z.object({
  userId: z.string().trim().min(1),
});

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { course, isManager } = parent;

  const [members, bulkAddForm] = await Promise.all([
    listMembersForCourse(course.id),
    superValidate({ handles: "", role: "student" as const }, zod4(bulkAddSchema)),
  ]);

  // Active-only filter mirrors the UI; removed rows live on the server for audit.
  // Placeholders are only exposed to managers — leaking placeholder usernames to
  // peers lets any student claim a pre-invited TA/teacher handle via the
  // self-service rename flow and inherit the course membership.
  const visibleMembers = members
    .filter((member) => member.status === "active")
    .filter((member) => isManager || !member.isPlaceholder)
    .map((member) => ({
      userId: member.userId,
      name: member.name,
      username: member.username,
      email: isManager ? member.email : null,
      role: member.role,
      isPlaceholder: member.isPlaceholder,
      joinedAt: member.joinedAt,
    }));

  return {
    members: visibleMembers,
    bulkAddForm,
  };
});

export const actions = {
  bulkAdd: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    // Defensive backstop for direct POSTs: `event.parent()` is unavailable in form actions.
    const role = await getCoursePermissionRole(event.params.courseId, actor);
    if (!canManageCourse(role)) {
      return fail(403, { error: "Forbidden" });
    }

    const form = await superValidate(event, zod4(bulkAddSchema));
    if (!form.valid) return fail(400, { form });

    const handles = parseHandleInput(form.data.handles);
    if (handles.length === 0) {
      return message<FormMessage>(
        form,
        { kind: "error", text: "No valid handles in input." },
        { status: 400 },
      );
    }

    try {
      const result = await bulkAddByHandle(actor, event.params.courseId, {
        handles,
        role: form.data.role,
      });
      return message<FormMessage>(form, {
        kind: "success",
        text: `Added ${String(result.added)} members (${String(result.placeholdersCreated)} new placeholders, ${String(result.skipped)} skipped)`,
      });
    } catch (err) {
      const classified = classifyError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: 400 },
      );
    }
  }),

  changeRole: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const role = await getCoursePermissionRole(event.params.courseId, actor);
    if (!canManageCourse(role)) {
      return fail(403, { error: "Forbidden" });
    }

    const form = await event.request.formData();
    const parsed = changeRoleSchema.safeParse({
      userId: form.get("userId"),
      role: form.get("role"),
    });
    if (!parsed.success) {
      return fail(400, { error: "Invalid role change request" });
    }

    try {
      await changeMemberRole(
        actor,
        event.params.courseId,
        parsed.data.userId,
        parsed.data.role,
      );
      return { success: true };
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
  }),

  remove: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const role = await getCoursePermissionRole(event.params.courseId, actor);
    if (!canManageCourse(role)) {
      return fail(403, { error: "Forbidden" });
    }

    const form = await event.request.formData();
    const parsed = removeSchema.safeParse({ userId: form.get("userId") });
    if (!parsed.success) {
      return fail(400, { error: "Invalid remove request" });
    }

    try {
      await removeMember(actor, event.params.courseId, parsed.data.userId);
      return { success: true };
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
  }),
} satisfies Actions;
