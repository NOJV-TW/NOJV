import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  formLimitMock,
  getAuthMock,
  linkSocialAccountMock,
  listUserAccountsMock,
  rawTwoFactorActions,
  requireAuthMock,
  unlinkAccountMock,
} = vi.hoisted(() => {
  const actionNames = [
    "sendSecuritySetupOtp",
    "unlockSecuritySettings",
    "beginTotpSetup",
    "confirmTotpSetup",
    "removeTotp",
    "regenerateBackupCodes",
    "deletePasskey",
  ] as const;
  const linkSocialAccountMock = vi.fn();
  const unlinkAccountMock = vi.fn();
  const listUserAccountsMock = vi.fn();
  return {
    formLimitMock: vi.fn(),
    getAuthMock: vi.fn(() => ({
      api: {
        linkSocialAccount: linkSocialAccountMock,
        listUserAccounts: listUserAccountsMock,
        unlinkAccount: unlinkAccountMock,
      },
    })),
    linkSocialAccountMock,
    listUserAccountsMock,
    rawTwoFactorActions: Object.fromEntries(actionNames.map((name) => [name, vi.fn()])),
    requireAuthMock: vi.fn(),
    unlinkAccountMock,
  };
});

vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: formLimitMock,
}));

vi.mock("$lib/../routes/(app)/settings/two-factor-actions", () => ({
  loadTwoFactor: vi.fn(),
  twoFactorActions: rawTwoFactorActions,
}));

vi.mock("$lib/server/shared/school-verification", () => ({
  handleSendVerificationAction: vi.fn(),
}));

vi.mock("$lib/auth.server", () => ({ getAuth: getAuthMock }));
vi.mock("$lib/server/auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@nojv/application", () => ({
  notificationDomain: {
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn(),
  },
}));
vi.mock("sveltekit-superforms/server", () => ({
  message: vi.fn(),
  superValidate: vi.fn(),
}));
vi.mock("sveltekit-superforms/adapters", () => ({ zod4: vi.fn() }));

const { actions } = await import("$lib/../routes/(app)/settings/+page.server");

const GUARDED_ACTIONS = [
  "sendSecuritySetupOtp",
  "unlockSecuritySettings",
  "beginTotpSetup",
  "confirmTotpSetup",
  "removeTotp",
  "regenerateBackupCodes",
  "deletePasskey",
  "link",
  "unlink",
] as const;

function makeEvent(): RequestEvent {
  return {
    locals: {
      user: { id: "usr_1" },
      sessionUser: { id: "usr_1" },
      apiTokenActor: null,
    },
    request: new Request("http://localhost/settings", {
      method: "POST",
      body: new FormData(),
    }),
    url: new URL("http://localhost/settings"),
    getClientAddress: () => "127.0.0.1",
  } as unknown as RequestEvent;
}

beforeEach(() => {
  formLimitMock.mockReset().mockResolvedValue({
    status: 503,
    data: { error: "Rate limiter unavailable." },
  });
  getAuthMock.mockClear();
  linkSocialAccountMock.mockReset();
  listUserAccountsMock.mockReset();
  requireAuthMock.mockReset();
  unlinkAccountMock.mockReset();
  for (const action of Object.values(rawTwoFactorActions)) action.mockReset();
});

describe("settings action rate-limit composition", () => {
  it("blocks every two-factor and connection action before any side effect", async () => {
    for (const name of GUARDED_ACTIONS) {
      await expect(actions[name](makeEvent())).resolves.toMatchObject({ status: 503 });
    }

    expect(formLimitMock).toHaveBeenCalledTimes(GUARDED_ACTIONS.length);
    for (const action of Object.values(rawTwoFactorActions)) {
      expect(action).not.toHaveBeenCalled();
    }
    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(getAuthMock).not.toHaveBeenCalled();
    expect(linkSocialAccountMock).not.toHaveBeenCalled();
    expect(unlinkAccountMock).not.toHaveBeenCalled();
  });
});

describe("settings account unlinking", () => {
  it("uses the current user's internal account ID while preserving unlink guards", async () => {
    formLimitMock.mockResolvedValue(null);
    const accounts = [
      { id: "acc_github", accountId: "external_github_id", providerId: "github" },
      { id: "acc_google", accountId: "external_google_id", providerId: "google" },
    ];
    listUserAccountsMock.mockResolvedValue(accounts);
    const event = makeEvent();
    const form = new FormData();
    form.set("provider", "github");
    event.request = new Request("http://localhost/settings", { method: "POST", body: form });

    await expect(actions.unlink(event)).resolves.toEqual({ unlinked: "github" });
    expect(unlinkAccountMock).toHaveBeenCalledWith({
      body: { accountId: "acc_github" },
      headers: event.request.headers,
    });
    unlinkAccountMock.mockClear();
    listUserAccountsMock.mockResolvedValue([accounts[0]]);
    event.request = new Request("http://localhost/settings", { method: "POST", body: form });
    await expect(actions.unlink(event)).resolves.toMatchObject({
      status: 400,
      data: { error: "orphan" },
    });
    expect(unlinkAccountMock).not.toHaveBeenCalled();

    listUserAccountsMock.mockResolvedValue([accounts[1]]);
    event.request = new Request("http://localhost/settings", { method: "POST", body: form });
    await expect(actions.unlink(event)).resolves.toMatchObject({
      status: 400,
      data: { error: "unlinkFailed" },
    });
    expect(unlinkAccountMock).not.toHaveBeenCalled();
  });
});
