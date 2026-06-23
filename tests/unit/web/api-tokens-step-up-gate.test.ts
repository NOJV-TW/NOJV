import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasFreshStepUpMock,
  markStepUpFreshMock,
  markTotpSeenMock,
  wasTotpSeenMock,
  verifyTotpStepUpMock,
  verifyBackupCodeStepUpMock,
  createApiTokenMock,
  updateApiTokenMock,
  rotateApiTokenMock,
  revokeApiTokenMock,
} = vi.hoisted(() => ({
  hasFreshStepUpMock: vi.fn(),
  markStepUpFreshMock: vi.fn(),
  markTotpSeenMock: vi.fn(),
  wasTotpSeenMock: vi.fn(),
  verifyTotpStepUpMock: vi.fn(),
  verifyBackupCodeStepUpMock: vi.fn(),
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
    markTotpSeen: markTotpSeenMock,
    wasTotpSeen: wasTotpSeenMock,
    verifyTotpStepUp: verifyTotpStepUpMock,
    verifyBackupCodeStepUp: verifyBackupCodeStepUpMock,
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
  markTotpSeenMock.mockReset().mockResolvedValue(undefined);
  wasTotpSeenMock.mockReset().mockResolvedValue(false);
  verifyTotpStepUpMock.mockReset();
  verifyBackupCodeStepUpMock.mockReset();
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
    const result = await verifyActions.default(verifyEvent("12ab"));
    expect(result).toMatchObject({ status: 400 });
    expect(verifyTotpStepUpMock).not.toHaveBeenCalled();
    expect(verifyBackupCodeStepUpMock).not.toHaveBeenCalled();
    expect(markStepUpFreshMock).not.toHaveBeenCalled();
  });

  it("verifies a TOTP code and marks step-up", async () => {
    verifyTotpStepUpMock.mockResolvedValue(true);
    const thrown = await caught(() => verifyActions.default(verifyEvent("123456")));
    expect(verifyTotpStepUpMock).toHaveBeenCalledOnce();
    expect(markTotpSeenMock).toHaveBeenCalledWith("usr_1", "123456");
    expect(markStepUpFreshMock).toHaveBeenCalledWith("usr_1");
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/account/api-tokens");
  });

  it("verifies a backup code, marks step-up, and redirects", async () => {
    verifyBackupCodeStepUpMock.mockResolvedValue(true);
    const thrown = await caught(() => verifyActions.default(verifyEvent("abc12-XY34z")));
    expect(verifyBackupCodeStepUpMock).toHaveBeenCalledOnce();
    expect(markStepUpFreshMock).toHaveBeenCalledWith("usr_1");
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/account/api-tokens");
  });

  it("does not touch the TOTP replay key for a backup code", async () => {
    verifyBackupCodeStepUpMock.mockResolvedValue(true);
    await caught(() => verifyActions.default(verifyEvent("abc12-XY34z")));
    expect(wasTotpSeenMock).not.toHaveBeenCalled();
    expect(markTotpSeenMock).not.toHaveBeenCalled();
    expect(verifyTotpStepUpMock).not.toHaveBeenCalled();
  });

  it("rejects a replayed TOTP code with fail(401)", async () => {
    wasTotpSeenMock.mockResolvedValue(true);
    const result = await verifyActions.default(verifyEvent("123456"));
    expect(result).toMatchObject({ status: 401 });
    expect(verifyTotpStepUpMock).not.toHaveBeenCalled();
    expect(markStepUpFreshMock).not.toHaveBeenCalled();
  });
});
