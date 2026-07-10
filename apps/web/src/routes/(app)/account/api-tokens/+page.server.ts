import { apiTokenDomain } from "@nojv/application";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

import { ForbiddenError, requireAuth } from "$lib/server/auth";
import { hasFreshStepUp, hasTokenPageMfa, isTwoFactorActivated } from "$lib/server/step-up";
import { withRateLimit } from "$lib/server/shared/action-handlers";

async function requireTokenMutationStepUp(event: RequestEvent): Promise<void> {
  const actor = requireAuth(event);
  if (!(await isTwoFactorActivated(actor.userId))) {
    throw new ForbiddenError("Two-factor authentication is required.");
  }
  if (!(await hasFreshStepUp(actor.userId))) {
    throw new ForbiddenError("Step-up verification required.");
  }
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readScopes(formData: FormData): string[] {
  return formData
    .getAll("scopes")
    .filter((value): value is string => typeof value === "string");
}

function readExpiry(formData: FormData): number {
  return Number.parseInt(readString(formData, "expiresInDays"), 10);
}

function classifyActionError(err: unknown): {
  errorKey: string;
  status: 400 | 403 | 404 | 500;
} {
  if (err instanceof Error) {
    const status = "status" in err && typeof err.status === "number" ? err.status : 500;
    if (status === 400) return { errorKey: "invalid", status: 400 };
    if (status === 403) return { errorKey: "forbidden", status: 403 };
    if (status === 404) return { errorKey: "notFound", status: 404 };
  }
  return { errorKey: "unexpected", status: 500 };
}

export const load = async (event: RequestEvent) => {
  if (!event.locals.user) {
    redirect(302, "/");
  }

  const actor = requireAuth(event);

  if (!(await isTwoFactorActivated(actor.userId))) {
    redirect(302, "/account?setup2fa=1&returnTo=" + encodeURIComponent("/account/api-tokens"));
  }
  const sessionId = event.locals.session?.id;
  if (!sessionId || !(await hasTokenPageMfa(sessionId))) {
    redirect(302, "/account/api-tokens/verify");
  }

  const tokens = await apiTokenDomain.listApiTokens(actor.userId);

  return {
    expiryPresets: apiTokenDomain.expiryPresets,
    scopes: apiTokenDomain.listAssignableApiTokenScopes(actor.platformRole),
    tokens,
  };
};

export const actions = {
  create: withRateLimit(async (event) => {
    const actor = requireAuth(event);

    try {
      await requireTokenMutationStepUp(event);
      const formData = await event.request.formData();
      const result = await apiTokenDomain.createApiToken({
        expiresInDays: readExpiry(formData),
        name: readString(formData, "name"),
        platformRole: actor.platformRole,
        scopes: readScopes(formData),
        userId: actor.userId,
      });
      return { kind: "created" as const, token: result.token, tokenItem: result.item };
    } catch (err) {
      const { errorKey, status } = classifyActionError(err);
      return fail(status, { errorKey });
    }
  }),

  update: withRateLimit(async (event) => {
    const actor = requireAuth(event);

    try {
      await requireTokenMutationStepUp(event);
      const formData = await event.request.formData();
      await apiTokenDomain.updateApiToken({
        expiresInDays: readExpiry(formData),
        id: readString(formData, "id"),
        name: readString(formData, "name"),
        platformRole: actor.platformRole,
        scopes: readScopes(formData),
        userId: actor.userId,
      });
      return { kind: "updated" as const };
    } catch (err) {
      const { errorKey, status } = classifyActionError(err);
      return fail(status, { errorKey });
    }
  }),

  rotate: withRateLimit(async (event) => {
    const actor = requireAuth(event);

    try {
      await requireTokenMutationStepUp(event);
      const formData = await event.request.formData();
      const result = await apiTokenDomain.rotateApiToken({
        id: readString(formData, "id"),
        userId: actor.userId,
      });
      return { kind: "rotated" as const, token: result.token, tokenItem: result.item };
    } catch (err) {
      const { errorKey, status } = classifyActionError(err);
      return fail(status, { errorKey });
    }
  }),

  revoke: withRateLimit(async (event) => {
    const actor = requireAuth(event);

    try {
      await requireTokenMutationStepUp(event);
      const formData = await event.request.formData();
      await apiTokenDomain.revokeApiToken({
        id: readString(formData, "id"),
        revokedById: actor.userId,
        userId: actor.userId,
      });
      return { kind: "revoked" as const };
    } catch (err) {
      const { errorKey, status } = classifyActionError(err);
      return fail(status, { errorKey });
    }
  }),
} satisfies Actions;
