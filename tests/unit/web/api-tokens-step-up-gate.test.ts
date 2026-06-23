import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasFreshStepUpMock,
  markStepUpFreshMock,
  verifyStepUpCodeMock,
  createApiTokenMock,
  updateApiTokenMock,
  rotateApiTokenMock,
  revokeApiTokenMock,
} = vi.hoisted(() => ({
  hasFreshStepUpMock: vi.fn(),
  markStepUpFreshMock: vi.fn(),
  verifyStepUpCodeMock: vi.fn(),
  createApiTokenMock: vi.fn(),
  updateApiTokenMock: vi.fn(),
  rotateApiTokenMock: vi.fn(),
  revokeApiTokenMock: vi.fn(),
}));

vi.mock("$lib/server/step-up", async () => {
  const actual =
    await vi.importActual<typeof import("$lib/server/step-up")>("$lib/server/step-up");
  return {
    ...actual,
    hasFreshStepUp: hasFreshStepUpMock,
    markStepUpFresh: markStepUpFreshMock,
    verifyStepUpCode: verifyStepUpCodeMock,
  };
});

vi.mock("@nojv/application", async () => {
  const actual = await vi.importActual<typeof import("@nojv/application")>("@nojv/application");
  return {
    ...actual,
    apiTokenDomain: {
      ...actual.apiTokenDomain,
      createApiToken: createApiTokenMock,
      updateApiToken: updateApiTokenMock,
      rotateApiToken: rotateApiTokenMock,
      revokeApiToken: revokeApiTokenMock,
      listApiTokens: vi.fn(),
      listAssignableApiTokenScopes: () => [],
      expiryPresets: [],
    },
  };
});

import { actions, load } from "$lib/../routes/(app)/account/api-tokens/+page.server";
import { actions as verifyActions } from "$lib/../routes/(app)/account/api-tokens/verify/+page.server";

function makeEvent(body?: FormData): RequestEvent {
  return {
    locals: {
      user: { id: "usr_1" },
      sessionUser: {
        id: "usr_1",
        username: "alice",
        name: "Alice",
        email: "a@example.com",
        emailVerified: true,
        platformRole: "student",
        twoFactorEnabled: true,
        disabled: false,
        mustChangePassword: false,
      },
      apiTokenActor: null,
    },
    request: new Request("http://localhost/account/api-tokens", {
      method: "POST",
      body: body ?? new FormData(),
    }),
    url: new URL("http://localhost/account/api-tokens"),
    getClientAddress: () => "127.0.0.1",
  } as unknown as RequestEvent;
}

function verifyEvent(code: string, returnTo = "/account/api-tokens"): RequestEvent {
  const body = new FormData();
  body.set("code", code);
  body.set("returnTo", returnTo);
  return makeEvent(body);
}

async function caught(
  fn: () => Promise<unknown>,
): Promise<{ status: number; location: string }> {
  try {
    await fn();
    throw new Error("expected a redirect to be thrown");
  } catch (err) {
    return err as { status: number; location: string };
  }
}

beforeEach(() => {
  hasFreshStepUpMock.mockReset();
  markStepUpFreshMock.mockReset().mockResolvedValue(undefined);
  verifyStepUpCodeMock.mockReset();
  createApiTokenMock.mockReset();
  updateApiTokenMock.mockReset();
  rotateApiTokenMock.mockReset();
  revokeApiTokenMock.mockReset();
});

describe("api-tokens load gate", () => {
  it("redirects to /verify when there is no fresh step-up marker", async () => {
    hasFreshStepUpMock.mockResolvedValue(false);
    const thrown = await caught(() => load(makeEvent()));
    expect(thrown.status).toBe(302);
    expect(thrown.location).toBe("/account/api-tokens/verify");
  });

  it("redirects to enroll when 2FA is not enabled", async () => {
    const event = makeEvent();
    (event.locals.sessionUser as { twoFactorEnabled: boolean }).twoFactorEnabled = false;
    const thrown = await caught(() => load(event));
    expect(thrown.status).toBe(302);
    expect(thrown.location).toBe(
      "/account/two-factor?returnTo=" + encodeURIComponent("/account/api-tokens"),
    );
  });
});

const guardedActions = [
  ["create", () => actions.create, createApiTokenMock] as const,
  ["update", () => actions.update, updateApiTokenMock] as const,
  ["rotate", () => actions.rotate, rotateApiTokenMock] as const,
  ["revoke", () => actions.revoke, revokeApiTokenMock] as const,
];

describe("api-tokens action guard", () => {
  it.each(guardedActions)(
    "%s returns fail(403) when there is no fresh step-up marker",
    async (_name, getAction, domainMock) => {
      hasFreshStepUpMock.mockResolvedValue(false);
      const result = await getAction()(makeEvent());
      expect(result).toMatchObject({ status: 403 });
      expect(domainMock).not.toHaveBeenCalled();
    },
  );

  it.each(guardedActions)(
    "%s returns fail(403) when the marker is fresh but 2FA is disabled",
    async (_name, getAction, domainMock) => {
      hasFreshStepUpMock.mockResolvedValue(true);
      const event = makeEvent();
      (event.locals.sessionUser as { twoFactorEnabled: boolean }).twoFactorEnabled = false;
      const result = await getAction()(event);
      expect(result).toMatchObject({ status: 403 });
      expect(domainMock).not.toHaveBeenCalled();
    },
  );

  it("create proceeds to the domain call when the marker is fresh", async () => {
    hasFreshStepUpMock.mockResolvedValue(true);
    createApiTokenMock.mockResolvedValue({ token: "tok", item: { id: "t1" } });
    const result = await actions.create(makeEvent());
    expect(createApiTokenMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ kind: "created" });
  });
});

describe("api-tokens verify action", () => {
  it("rejects a malformed code with fail(400)", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "malformed" });
    const result = await verifyActions.default(verifyEvent("12ab"));
    expect(result).toMatchObject({ status: 400 });
    expect(markStepUpFreshMock).not.toHaveBeenCalled();
  });

  it("verifies a valid code and marks step-up", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    const thrown = await caught(() => verifyActions.default(verifyEvent("123456")));
    expect(verifyStepUpCodeMock).toHaveBeenCalledWith("usr_1", "123456", expect.any(Headers));
    expect(markStepUpFreshMock).toHaveBeenCalledWith("usr_1");
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/account/api-tokens");
  });

  it("verifies a backup code, marks step-up, and redirects", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    const thrown = await caught(() => verifyActions.default(verifyEvent("abc12-XY34z")));
    expect(verifyStepUpCodeMock).toHaveBeenCalledOnce();
    expect(markStepUpFreshMock).toHaveBeenCalledWith("usr_1");
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/account/api-tokens");
  });

  it("rejects a replayed TOTP code with fail(401)", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "replayed" });
    const result = await verifyActions.default(verifyEvent("123456"));
    expect(result).toMatchObject({ status: 401 });
    expect(markStepUpFreshMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid code with fail(401)", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await verifyActions.default(verifyEvent("123456"));
    expect(result).toMatchObject({ status: 401 });
    expect(markStepUpFreshMock).not.toHaveBeenCalled();
  });
});
