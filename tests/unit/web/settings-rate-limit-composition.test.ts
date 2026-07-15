import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  formLimitMock,
  getAuthMock,
  linkSocialAccountMock,
  rawTwoFactorActions,
  requireAuthMock,
  unlinkAccountMock,
} = vi.hoisted(() => {
  const actionNames = [
    "sendEmailOtp",
    "activate",
    "deactivate",
    "enable",
    "verify",
    "disable",
    "regenerate",
    "deletePasskey",
  ] as const;
  const linkSocialAccountMock = vi.fn();
  const unlinkAccountMock = vi.fn();
  return {
    formLimitMock: vi.fn(),
    getAuthMock: vi.fn(() => ({
      api: {
        linkSocialAccount: linkSocialAccountMock,
        listUserAccounts: vi.fn(),
        unlinkAccount: unlinkAccountMock,
      },
    })),
    linkSocialAccountMock,
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
  "sendEmailOtp",
  "activate",
  "deactivate",
  "enable",
  "verify",
  "disable",
  "regenerate",
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
