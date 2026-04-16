import { userDomain } from "@nojv/domain";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import { isReservedUsername } from "$lib/school";
import { requireAuth } from "$lib/server/auth";
import { handleSendVerificationAction } from "$lib/server/shared/school-verification";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import type { FormMessage } from "$lib/types/form-message";

import type { Actions, PageServerLoad } from "./$types";
import { nameSchema, usernameSchema } from "./schemas";

// Map domain error `.message` codes → HTTP status for the message envelope.
const ERROR_STATUS: Record<string, number> = {
  VERIFIED_LOCKED: 409,
  PLACEHOLDER_LOCKED: 403,
  TAKEN: 409,
  RESERVED_FORMAT: 409,
  INVALID_FORMAT: 400,
  INVALID_NAME: 400
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

export const load: PageServerLoad = async (event) => {
  const { locals } = event;
  if (!locals.user) {
    redirect(302, "/");
  }

  const sessionUser = locals.sessionUser;
  const username = sessionUser?.username ?? null;
  const platformRole = sessionUser?.platformRole ?? "student";
  const isSchoolVerified = username !== null && isReservedUsername(username);

  // `status` is a better-auth additionalField registered in `$lib/auth.ts` but
  // not in the SessionUser zod schema; access it via a narrow cast rather than
  // widening the shared type from this route.
  const status = (sessionUser as { status?: string } | null)?.status;
  const canEditUsername = !isSchoolVerified && status !== "pending_first_login";

  const nameForm = await superValidate({ name: locals.user.name }, zod4(nameSchema));
  const usernameForm = await superValidate({ username: username ?? "" }, zod4(usernameSchema));

  return {
    email: locals.user.email,
    username: username ?? "\u2014",
    isSchoolVerified,
    canEditUsername,
    name: locals.user.name,
    platformRole,
    nameForm,
    usernameForm
  };
};

export const actions = {
  sendVerification: handleSendVerificationAction,

  updateName: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
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
        { status: status as 400 | 403 | 409 | 500 }
      );
    }

    return message<FormMessage>(form, { kind: "success", text: "OK" });
  },

  updateUsername: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
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
        { status: status as 400 | 403 | 409 | 500 }
      );
    }

    return message<FormMessage>(form, {
      kind: "success",
      text: merged ? "MERGED" : "OK"
    });
  }
} satisfies Actions;
