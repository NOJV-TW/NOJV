import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isTwoFactorActivatedMock,
  hasTokenPageMfaMock,
  hasFreshStepUpMock,
  markVerifiedSessionMock,
  grantAdminElevationMock,
  verifyStepUpCodeMock,
  createApiTokenMock,
  updateApiTokenMock,
  rotateApiTokenMock,
  revokeApiTokenMock,
  stepUpConsumeMock,
  formLimitMock,
} = vi.hoisted(() => ({
  isTwoFactorActivatedMock: vi.fn(),
  hasTokenPageMfaMock: vi.fn(),
  hasFreshStepUpMock: vi.fn(),
  markVerifiedSessionMock: vi.fn(),
  grantAdminElevationMock: vi.fn(),
  verifyStepUpCodeMock: vi.fn(),
  createApiTokenMock: vi.fn(),
  updateApiTokenMock: vi.fn(),
  rotateApiTokenMock: vi.fn(),
  revokeApiTokenMock: vi.fn(),
  stepUpConsumeMock: vi.fn(),
  formLimitMock: vi.fn(),
}));

vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: formLimitMock,
  stepUpAttemptRateLimiter: { consume: stepUpConsumeMock },
}));

vi.mock("$lib/server/step-up", async () => {
  const actual =
    await vi.importActual<typeof import("$lib/server/step-up")>("$lib/server/step-up");
  return {
    ...actual,
    isTwoFactorActivated: isTwoFactorActivatedMock,
    hasTokenPageMfa: hasTokenPageMfaMock,
    hasFreshStepUp: hasFreshStepUpMock,
    markVerifiedSession: markVerifiedSessionMock,
    grantAdminElevation: grantAdminElevationMock,
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
      session: { id: "sess_1" },
      sessionUser: {
        id: "usr_1",
        username: "alice",
        name: "Alice",
        email: "a@example.com",
        emailVerified: true,
        platformRole: "student",
        twoFactorEnabled: true,
        twoFactorActivated: true,
        disabled: false,
        isSuperAdmin: false,
        mustChangePassword: false,
        securityGeneration: 7,
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

function verifyEvent(code: string, purpose = "api-tokens", returnTo?: string): RequestEvent {
  const body = new FormData();
  body.set("code", code);
  body.set("purpose", purpose);
  if (returnTo) body.set("returnTo", returnTo);
  const event = makeEvent(body);
  if (purpose === "admin-mode") {
    event.locals.sessionUser!.platformRole = "admin";
  }
  return event;
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
  isTwoFactorActivatedMock.mockReset().mockResolvedValue(true);
  hasTokenPageMfaMock.mockReset().mockResolvedValue(true);
  hasFreshStepUpMock.mockReset().mockResolvedValue(true);
  markVerifiedSessionMock.mockReset().mockResolvedValue(true);
  grantAdminElevationMock.mockReset().mockResolvedValue(true);
  verifyStepUpCodeMock.mockReset();
  createApiTokenMock.mockReset();
  updateApiTokenMock.mockReset();
  rotateApiTokenMock.mockReset();
  revokeApiTokenMock.mockReset();
  stepUpConsumeMock.mockReset().mockResolvedValue("allowed");
  formLimitMock.mockReset().mockResolvedValue(null);
});

describe("api-tokens load gate", () => {
  it("redirects to account setup when the master switch is off", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(false);
    const thrown = await caught(() => load(makeEvent()));
    expect(thrown.status).toBe(302);
    expect(thrown.location).toBe(
      "/settings?setup2fa=1&returnTo=" + encodeURIComponent("/account/api-tokens"),
    );
  });

  it("redirects to /verify when the session has not passed the token-page step-up", async () => {
    hasTokenPageMfaMock.mockResolvedValue(false);
    const thrown = await caught(() => load(makeEvent()));
    expect(thrown.status).toBe(302);
    expect(thrown.location).toBe("/account/api-tokens/verify");
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
    "%s returns fail(403) when the fresh (10-minute) step-up marker is missing",
    async (_name, getAction, domainMock) => {
      hasFreshStepUpMock.mockResolvedValue(false);
      const result = await getAction()(makeEvent());
      expect(result).toMatchObject({ status: 403 });
      expect(hasFreshStepUpMock).toHaveBeenCalledWith("sess_1", {
        userId: "usr_1",
        securityGeneration: 7,
      });
      expect(domainMock).not.toHaveBeenCalled();
    },
  );

  it.each(guardedActions)(
    "%s still requires a fresh step-up even when the 1h page marker is present",
    async (_name, getAction, domainMock) => {
      hasTokenPageMfaMock.mockResolvedValue(true);
      hasFreshStepUpMock.mockResolvedValue(false);
      const result = await getAction()(makeEvent());
      expect(result).toMatchObject({ status: 403 });
      expect(domainMock).not.toHaveBeenCalled();
    },
  );

  it.each(guardedActions)(
    "%s returns fail(403) when the master switch is off",
    async (_name, getAction, domainMock) => {
      isTwoFactorActivatedMock.mockResolvedValue(false);
      const result = await getAction()(makeEvent());
      expect(result).toMatchObject({ status: 403 });
      expect(domainMock).not.toHaveBeenCalled();
    },
  );

  it("create proceeds to the domain call when activated and the step-up is fresh", async () => {
    createApiTokenMock.mockResolvedValue({ token: "tok", item: { id: "t1" } });
    const result = await actions.create(makeEvent());
    expect(createApiTokenMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ kind: "created" });
  });
});

describe("api-tokens verify action", () => {
  it("returns the form limiter failure before consuming step-up quota", async () => {
    formLimitMock.mockResolvedValue({ status: 503, data: { error: "unavailable" } });
    const result = await verifyActions.default(verifyEvent("123456"));
    expect(result).toMatchObject({ status: 503 });
    expect(stepUpConsumeMock).not.toHaveBeenCalled();
    expect(verifyStepUpCodeMock).not.toHaveBeenCalled();
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the verification quota is exhausted", async () => {
    stepUpConsumeMock.mockResolvedValue("limited");
    const result = await verifyActions.default(verifyEvent("123456"));
    expect(result).toMatchObject({ status: 429 });
    expect(verifyStepUpCodeMock).not.toHaveBeenCalled();
  });

  it("returns 503 when verification limiting is unavailable", async () => {
    stepUpConsumeMock.mockResolvedValue("unavailable");
    const result = await verifyActions.default(verifyEvent("123456"));
    expect(result).toMatchObject({ status: 503 });
    expect(verifyStepUpCodeMock).not.toHaveBeenCalled();
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
  });

  it("does not disguise an unknown verification-limiter error", async () => {
    const limiterError = new Error("limiter bug");
    stepUpConsumeMock.mockRejectedValue(limiterError);
    await expect(verifyActions.default(verifyEvent("123456"))).rejects.toBe(limiterError);
    expect(verifyStepUpCodeMock).not.toHaveBeenCalled();
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed code with fail(400)", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "malformed" });
    const result = await verifyActions.default(verifyEvent("12ab"));
    expect(result).toMatchObject({ status: 400 });
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
  });

  it("verifies a valid code and marks the token-page step-up", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    const thrown = await caught(() => verifyActions.default(verifyEvent("123456")));
    expect(verifyStepUpCodeMock).toHaveBeenCalledWith(
      { userId: "usr_1", securityGeneration: 7 },
      "123456",
      expect.any(Headers),
      true,
    );
    expect(markVerifiedSessionMock).toHaveBeenCalledWith(
      "sess_1",
      { userId: "usr_1", securityGeneration: 7 },
      false,
    );
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/account/api-tokens");
  });

  it("rejects a recovery code for privileged step-up", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "malformed" });
    const result = await verifyActions.default(verifyEvent("abc12-XY34z"));
    expect(verifyStepUpCodeMock).toHaveBeenCalledOnce();
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400 });
  });

  it("grants admin mode only after a verified code for the fixed admin-mode purpose", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });

    const thrown = await caught(() =>
      verifyActions.default(verifyEvent("123456", "admin-mode")),
    );

    const proof = { userId: "usr_1", securityGeneration: 7 };
    expect(markVerifiedSessionMock).toHaveBeenCalledWith("sess_1", proof, true);
    expect(grantAdminElevationMock).toHaveBeenCalledWith("sess_1", {
      ...proof,
      disabled: false,
      platformRole: "admin",
      twoFactorActivated: true,
    });
    expect(thrown).toEqual({ status: 303, location: "/admin" });
  });

  it("ignores arbitrary returnTo values and uses the purpose's fixed destination", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });

    const thrown = await caught(() =>
      verifyActions.default(
        verifyEvent("123456", "https://evil.test", "//evil.test/steal-session"),
      ),
    );

    expect(grantAdminElevationMock).not.toHaveBeenCalled();
    expect(thrown).toEqual({ status: 303, location: "/account/api-tokens" });
  });

  it("rejects a replayed TOTP code with fail(401)", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "replayed" });
    const result = await verifyActions.default(verifyEvent("123456"));
    expect(result).toMatchObject({ status: 401 });
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid code with fail(401)", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await verifyActions.default(verifyEvent("123456"));
    expect(result).toMatchObject({ status: 401 });
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
  });
});
