import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationCreateInput } from "@nojv/db";
import type { SendEmailInput, SendEmailResult } from "@nojv/mailer";

const { findEmailDeliveryContext, sendEmail } = vi.hoisted(() => ({
  findEmailDeliveryContext: vi.fn(),
  sendEmail: vi
    .fn<(input: SendEmailInput) => Promise<SendEmailResult>>()
    .mockResolvedValue("accepted"),
}));

vi.mock("@nojv/db", () => ({
  notificationRepo: { findEmailDeliveryContext },
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

function input(
  type: NotificationCreateInput["type"],
  params: NotificationCreateInput["params"],
): NotificationCreateInput {
  return { userId: "user-1", type, params, linkUrl: "/target" };
}

function currentContext(
  recipient: Partial<{
    email: string;
    emailVerified: boolean;
    disabled: boolean;
    status: "active" | "pending_first_login";
    notificationPreference: Record<string, unknown> | null;
  }> = {},
) {
  return {
    recipientExists: true,
    notification: {
      userId: "user-1",
      type: "course_enrolled",
      params: { courseName: "Algorithms" },
      user: {
        email: "student@example.com",
        emailVerified: true,
        disabled: false,
        status: "active" as const,
        notificationPreference: null,
        ...recipient,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findEmailDeliveryContext.mockResolvedValue(currentContext());
  sendEmail.mockResolvedValue("accepted");
});

describe("notification email durable delivery", () => {
  it.each([
    ["assignment_started", { title: "作業" }, "作業", "emailAssignmentStarted"],
    ["assignment_due_soon", { title: "作業" }, "作業", "emailAssignmentDueSoon"],
    ["exam_starting_soon", { title: "考試" }, "考試", "emailExamStarting"],
    ["contest_starting_soon", { title: "比賽" }, "比賽", "emailContestStarting"],
    ["announcement_published", { titleZhTw: "公告" }, "公告", "emailSystemAnnouncement"],
    ["course_enrolled", { courseName: "演算法" }, "演算法", "emailCourseEnrolled"],
    ["role_changed", { newRole: "teacher" }, "權限", "emailRoleChanged"],
    ["editorial_removed", { title: "題解" }, "題解", "emailEditorialRemoved"],
    ["post_removed", { title: "文章" }, "文章", "emailEditorialRemoved"],
    ["comment_removed", { postTitle: "文章" }, "文章", "emailEditorialRemoved"],
  ] as const)(
    "snapshots immutable content and event identity for supported type %s",
    (type, params, expectedText, preferenceKey) => {
      const work = buildNotificationEmailWork(`notification-${type}`, input(type, params));

      expect(work).toMatchObject({
        disposition: "send",
        userId: "user-1",
        notificationType: type,
        preferenceKey,
        messageId: `<notification.notification-${type}@nojv.local>`,
      });
      if (work.disposition !== "send") throw new Error("Expected send work.");
      expect(work).not.toHaveProperty("to");
      expect(work.subject).toContain(expectedText);
      expect(work.html).toContain("https://nojv.tw/target");
    },
  );

  it("records unsupported types as an explicit terminal suppression", async () => {
    const work = buildNotificationEmailWork(
      "unsupported",
      input("clarification_answered", { clarificationId: "clarification-1" }),
    );

    await expect(deliverNotificationEmail(work)).resolves.toEqual({
      transport: "email",
      outcome: "suppressed",
      reason: "unsupported_notification_type",
    });
    expect(findEmailDeliveryContext).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    [
      "notification deletion",
      { notification: null, recipientExists: true },
      "notification_missing",
    ],
    ["account deletion", { notification: null, recipientExists: false }, "missing_recipient"],
    ["account disable", currentContext({ disabled: true }), "recipient_disabled"],
    [
      "account status change",
      currentContext({ status: "pending_first_login" }),
      "recipient_inactive",
    ],
    [
      "email verification revocation",
      currentContext({ emailVerified: false }),
      "unverified_recipient",
    ],
    [
      "address replacement with a placeholder",
      currentContext({ email: "student@placeholder.nojv.local" }),
      "placeholder_recipient",
    ],
    [
      "preference opt-out",
      currentContext({ notificationPreference: { emailCourseEnrolled: false } }),
      "preference_disabled",
    ],
  ] as const)(
    "suppresses %s that occurs after enqueue and before delivery",
    async (_transition, context, reason) => {
      findEmailDeliveryContext.mockResolvedValue(context);
      const work = buildNotificationEmailWork(
        "notification-1",
        input("course_enrolled", { courseName: "Algorithms" }),
      );

      await expect(deliverNotificationEmail(work)).resolves.toEqual({
        transport: "email",
        outcome: "suppressed",
        reason,
      });
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );

  it("resolves the current verified address at execution instead of using the enqueued address", async () => {
    findEmailDeliveryContext.mockResolvedValue(
      currentContext({ email: "current@example.com" }),
    );
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
    );

    await expect(deliverNotificationEmail(work)).resolves.toMatchObject({
      outcome: "accepted",
      deliverySemantics: "at_least_once",
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "current@example.com",
        messageId: "<notification.notification-1@nojv.local>",
      }),
    );
  });

  it("rejects a durable payload whose immutable event identity does not match the row", async () => {
    findEmailDeliveryContext.mockResolvedValue({
      ...currentContext(),
      notification: { ...currentContext().notification, userId: "different-user" },
    });
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
    );

    await expect(deliverNotificationEmail(work)).rejects.toThrow(
      "Notification email work identity mismatch",
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("uses at-least-once SMTP delivery with a stable Message-ID across retries", async () => {
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
    );

    const first = await deliverNotificationEmail(work);
    const retryAfterAcceptanceBeforeCompletion = await deliverNotificationEmail(work);

    expect(first).toEqual({
      transport: "email",
      outcome: "accepted",
      deliverySemantics: "at_least_once",
      messageId: "<notification.notification-1@nojv.local>",
    });
    expect(retryAfterAcceptanceBeforeCompletion).toEqual(first);
    expect(sendEmail).toHaveBeenCalledTimes(2);
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
    );

    await expect(deliverNotificationEmail(work)).rejects.toThrow("smtp down");
  });

  it("escapes HTML body content while keeping the plain-text subject", () => {
    const work = buildNotificationEmailWork(
      "notification-1",
      input("assignment_started", { title: '<a href="evil">x</a>' }),
    );

    if (work.disposition !== "send") throw new Error("Expected send work.");
    expect(work.subject).toContain('<a href="evil">x</a>');
    expect(work.html).toContain("&lt;a href=&quot;evil&quot;&gt;x&lt;/a&gt;");
    expect(work.html).not.toContain('<a href="evil">');
  });
});
