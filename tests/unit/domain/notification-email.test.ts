import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "@nojv/core";
import type { NotificationCreateInput } from "@nojv/db";
import type { SendEmailInput, SendEmailResult } from "@nojv/mailer";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi
    .fn<(input: SendEmailInput) => Promise<SendEmailResult>>()
    .mockResolvedValue("accepted"),
}));

vi.mock("@nojv/mailer", () => ({
  getMailer: () => ({ sendEmail }),
  getAppBaseUrl: () => "https://nojv.tw",
  renderEmail: (content: unknown) => JSON.stringify(content),
}));

import {
  buildNotificationEmailWork,
  deliverNotificationEmail,
} from "../../../packages/application/src/notification/email";

const recipient = { email: "student@example.com", emailVerified: true };

function input(
  type: NotificationCreateInput["type"],
  params: NotificationCreateInput["params"],
): NotificationCreateInput {
  return { userId: "user-1", type, params, linkUrl: "/target" };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue("accepted");
});

describe("notification email durable delivery", () => {
  it.each([
    ["assignment_started", { title: "作業" }, "作業"],
    ["assignment_due_soon", { title: "作業" }, "作業"],
    ["exam_starting_soon", { title: "考試" }, "考試"],
    ["contest_starting_soon", { title: "比賽" }, "比賽"],
    ["announcement_published", { titleZhTw: "公告" }, "公告"],
    ["course_enrolled", { courseName: "演算法" }, "演算法"],
    ["role_changed", { newRole: "teacher" }, "權限"],
    ["editorial_removed", { title: "題解" }, "題解"],
    ["post_removed", { title: "文章" }, "文章"],
    ["comment_removed", { postTitle: "文章" }, "文章"],
  ] as const)("snapshots supported type %s", (type, params, expectedText) => {
    const work = buildNotificationEmailWork(
      `notification-${type}`,
      input(type, params),
      recipient,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );

    expect(work).toMatchObject({
      disposition: "send",
      to: recipient.email,
      messageId: `<notification.notification-${type}@nojv.local>`,
    });
    if (work.disposition !== "send") throw new Error("Expected send work.");
    expect(work.subject).toContain(expectedText);
    expect(work.html).toContain("https://nojv.tw/target");
  });

  it("snapshots every suppression policy as an explicit terminal outcome", async () => {
    const baseInput = input("course_enrolled", { courseName: "Algorithms" });
    const disabled = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      emailCourseEnrolled: false,
    };
    const work = [
      buildNotificationEmailWork(
        "missing",
        baseInput,
        undefined,
        DEFAULT_NOTIFICATION_PREFERENCES,
      ),
      buildNotificationEmailWork(
        "unverified",
        baseInput,
        { email: "student@example.com", emailVerified: false },
        DEFAULT_NOTIFICATION_PREFERENCES,
      ),
      buildNotificationEmailWork(
        "placeholder",
        baseInput,
        { email: "student@placeholder.nojv.local", emailVerified: true },
        DEFAULT_NOTIFICATION_PREFERENCES,
      ),
      buildNotificationEmailWork("disabled", baseInput, recipient, disabled),
      buildNotificationEmailWork(
        "unsupported",
        input("clarification_answered", { clarificationId: "clarification-1" }),
        recipient,
        DEFAULT_NOTIFICATION_PREFERENCES,
      ),
    ];

    await expect(Promise.all(work.map(deliverNotificationEmail))).resolves.toEqual([
      { transport: "email", outcome: "suppressed", reason: "missing_recipient" },
      { transport: "email", outcome: "suppressed", reason: "unverified_recipient" },
      { transport: "email", outcome: "suppressed", reason: "placeholder_recipient" },
      { transport: "email", outcome: "suppressed", reason: "preference_disabled" },
      { transport: "email", outcome: "suppressed", reason: "unsupported_notification_type" },
    ]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reuses one deterministic Message-ID when retried after SMTP acceptance", async () => {
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
      recipient,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );

    const first = await deliverNotificationEmail(work);
    const retryAfterAcceptanceBeforeCompletion = await deliverNotificationEmail(work);

    expect(first).toEqual({
      transport: "email",
      outcome: "accepted",
      messageId: "<notification.notification-1@nojv.local>",
    });
    expect(retryAfterAcceptanceBeforeCompletion).toEqual(first);
    expect(sendEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ messageId: "<notification.notification-1@nojv.local>" }),
    );
    expect(sendEmail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ messageId: "<notification.notification-1@nojv.local>" }),
    );
  });

  it("persists mailer suppression as a distinct result", async () => {
    sendEmail.mockResolvedValue("suppressed");
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
      recipient,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );

    await expect(deliverNotificationEmail(work)).resolves.toEqual({
      transport: "email",
      outcome: "suppressed",
      reason: "mailer_suppressed",
      messageId: "<notification.notification-1@nojv.local>",
    });
  });

  it("propagates SMTP failure for database-owned retry", async () => {
    sendEmail.mockRejectedValue(new Error("smtp down"));
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
      recipient,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );

    await expect(deliverNotificationEmail(work)).rejects.toThrow("smtp down");
  });

  it("escapes HTML body content while keeping the plain-text subject", () => {
    const work = buildNotificationEmailWork(
      "notification-1",
      input("assignment_started", { title: '<a href="evil">x</a>' }),
      recipient,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );

    if (work.disposition !== "send") throw new Error("Expected send work.");
    expect(work.subject).toContain('<a href="evil">x</a>');
    expect(work.html).toContain("&lt;a href=&quot;evil&quot;&gt;x&lt;/a&gt;");
    expect(work.html).not.toContain('<a href="evil">');
  });
});
