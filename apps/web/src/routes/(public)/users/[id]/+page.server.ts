import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { NotFoundError, userDomain } from "@nojv/application";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { isReservedUsername } from "$lib/utils/school";
import type { FormMessage } from "$lib/types/form-message";
import { nameSchema, usernameSchema } from "./schemas";

const { canViewProfile, getPublicProfile } = userDomain;

const ERROR_STATUS: Record<string, number> = {
  VERIFIED_LOCKED: 409,
  PLACEHOLDER_LOCKED: 403,
  TAKEN: 409,
  RESERVED_FORMAT: 409,
  INVALID_FORMAT: 400,
  INVALID_NAME: 400,
};

function classifyDomainError(err: unknown): { code: string; status: number } {
  if (err instanceof Error) {
    const mapped = ERROR_STATUS[err.message];
    if (mapped !== undefined) {
      return { code: err.message, status: mapped };
    }
  }
  return { code: "UNEXPECTED", status: 500 };
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const profile = await getPublicProfile(event.params.id);

  const sessionUser = event.locals.sessionUser;
  const viewer = sessionUser
    ? {
        userId: sessionUser.id,
        isAdmin: sessionUser.platformRole === "admin" && event.locals.adminModeActive,
      }
    : null;

  if (!canViewProfile(viewer, profile.user)) {
    throw new NotFoundError("User not found");
  }

  const isOwner = viewer?.userId === profile.user.id;

  let owner = null;
  if (isOwner && sessionUser) {
    const username = sessionUser.username ?? null;
    const isSchoolVerified = username !== null && isReservedUsername(username);
    owner = {
      platformRole: sessionUser.platformRole,
      isSchoolVerified,
      canEditUsername: !isSchoolVerified && sessionUser.status !== "pending_first_login",
      nameForm: await superValidate({ name: profile.user.name }, zod4(nameSchema)),
      usernameForm: await superValidate({ username: username ?? "" }, zod4(usernameSchema)),
    };
  }

  return {
    profile: {
      ...profile,
      activity: profile.activity.map((e) => ({ at: e.createdAt.toISOString(), ac: e.isAc })),
    },
    isOwner,
    owner,
  };
});

export const actions = {
  updateProfileVisibility: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    if (actor.userId !== event.params.id) {
      return fail(403);
    }

    const formData = await event.request.formData();
    const profilePublic = formData.get("profilePublic") === "true";

    await userDomain.updateProfileVisibility(actor.userId, profilePublic);

    return { success: true };
  }),

  updateName: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    if (actor.userId !== event.params.id) {
      return fail(403);
    }
    const form = await superValidate(event, zod4(nameSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    try {
      await userDomain.renameName(actor.userId, form.data.name);
    } catch (err) {
      const { code, status } = classifyDomainError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: code },
        { status: status as 400 | 403 | 409 | 500 },
      );
    }

    return message<FormMessage>(form, { kind: "success", text: "OK" });
  }),

  updateUsername: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    if (actor.userId !== event.params.id) {
      return fail(403);
    }
    const form = await superValidate(event, zod4(usernameSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    let merged: boolean;
    try {
      const result = await userDomain.renameUsername(actor.userId, form.data.username);
      merged = result.merged;
    } catch (err) {
      const { code, status } = classifyDomainError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: code },
        { status: status as 400 | 403 | 409 | 500 },
      );
    }

    return message<FormMessage>(form, {
      kind: "success",
      text: merged ? "MERGED" : "OK",
    });
  }),
} satisfies Actions;
