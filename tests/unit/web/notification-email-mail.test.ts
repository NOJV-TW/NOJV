import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestNotificationEmail, sendEmail } = vi.hoisted(() => ({
  requestNotificationEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@nojv/application", () => ({
  notificationDomain: { requestNotificationEmail },
}));
vi.mock("@nojv/mailer", () => ({
  getAppBaseUrl: () => "https://app.nojv.test",
  getMailer: () => ({ sendEmail }),
  renderEmail: (content: unknown) => JSON.stringify(content),
}));
vi.mock("$lib/server/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: vi.fn().mockResolvedValue(null),
}));

import { handleSendNotificationEmailAction } from "$lib/server/shared/notification-email";

function event(email: string) {
  const body = new FormData();
  body.set("email", email);
  return {
    locals: { user: { id: "user-1" } },
    url: new URL("https://app.nojv.test/settings"),
    request: new Request("https://app.nojv.test/settings?/sendNotificationEmail", {
      method: "POST",
      body,
    }),
  } as unknown as Parameters<typeof handleSendNotificationEmailAction>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  requestNotificationEmail.mockResolvedValue("token-123");
  sendEmail.mockResolvedValue("accepted");
});

describe("notification email confirmation delivery", () => {
  it("sends the confirmation link to the new address only after SMTP accepts", async () => {
    await expect(
      handleSendNotificationEmailAction(event("Inbox@Example.com")),
    ).resolves.toEqual({
      success: true,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "inbox@example.com",
        html: expect.stringContaining(
          "https://app.nojv.test/verify-notification-email?token=token-123",
        ),
      }),
    );
  });

  it("does not report success when delivery is suppressed", async () => {
    sendEmail.mockResolvedValue("suppressed");
    const result = await handleSendNotificationEmailAction(event("inbox@example.com"));
    expect(result).toMatchObject({ status: 503 });
  });
});
