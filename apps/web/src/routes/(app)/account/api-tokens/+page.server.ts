import { apiTokenDomain } from "@nojv/application";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

import { requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";

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

function classifyActionError(err: unknown): { message: string; status: 400 | 403 | 404 | 500 } {
  if (err instanceof Error) {
    const status = "status" in err && typeof err.status === "number" ? err.status : 500;
    if (status === 400 || status === 403 || status === 404) {
      return { message: err.message, status };
    }
    return { message: err.message, status: 500 };
  }
  return { message: "Unexpected API token error.", status: 500 };
}

export const load = async (event: RequestEvent) => {
  if (!event.locals.user) {
    redirect(302, "/");
  }

  const actor = requireAuth(event);
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
    const formData = await event.request.formData();

    try {
      const result = await apiTokenDomain.createApiToken({
        expiresInDays: readExpiry(formData),
        name: readString(formData, "name"),
        platformRole: actor.platformRole,
        scopes: readScopes(formData),
        userId: actor.userId,
      });
      return { kind: "created" as const, token: result.token, tokenItem: result.item };
    } catch (err) {
      const { message, status } = classifyActionError(err);
      return fail(status, { error: message });
    }
  }),

  update: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();

    try {
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
      const { message, status } = classifyActionError(err);
      return fail(status, { error: message });
    }
  }),

  rotate: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();

    try {
      const result = await apiTokenDomain.rotateApiToken({
        id: readString(formData, "id"),
        userId: actor.userId,
      });
      return { kind: "rotated" as const, token: result.token, tokenItem: result.item };
    } catch (err) {
      const { message, status } = classifyActionError(err);
      return fail(status, { error: message });
    }
  }),

  revoke: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();

    try {
      await apiTokenDomain.revokeApiToken({
        id: readString(formData, "id"),
        revokedById: actor.userId,
        userId: actor.userId,
      });
      return { kind: "revoked" as const };
    } catch (err) {
      const { message, status } = classifyActionError(err);
      return fail(status, { error: message });
    }
  }),
} satisfies Actions;
