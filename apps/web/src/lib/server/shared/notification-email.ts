import { fail } from "@sveltejs/kit";
import { notificationDomain } from "@nojv/application";
import { getAppBaseUrl, getMailer, renderEmail } from "@nojv/mailer";

import { createLogger } from "../logger";
import { withAction } from "./action-handlers";
import { classifyRequestError } from "./handle-action-error";

const logger = createLogger("notification-email");

export const handleSendNotificationEmailAction = withAction(async (event) => {
  const user = event.locals.user;
  if (!user) return fail(401, { error: "Unauthorized" });

  const value = (await event.request.formData()).get("email");
  const email = typeof value === "string" ? value.trim() : "";
  let token: string;
  try {
    token = await notificationDomain.requestNotificationEmail(user.id, email);
  } catch (error) {
    const classified = classifyRequestError(error, event);
    return fail(classified.status, { error: classified.message });
  }

  const verifyUrl = `${getAppBaseUrl()}/verify-notification-email?token=${token}`;
  try {
    const delivery = await getMailer().sendEmail({
      to: email.toLowerCase(),
      subject: "NOJV 通知信箱驗證 · Verify your notification email",
      html: renderEmail({
        heading: "驗證通知信箱 · Verify notification email",
        intro:
          "<p>請點擊下方按鈕，確認以這個信箱接收 NOJV 的通知。</p><p>Click the button below to confirm receiving NOJV notifications at this address.</p>",
        action: { url: verifyUrl, label: "確認 · Confirm" },
        outro:
          "此連結將在 30 分鐘後失效。若您沒有提出此要求，請忽略這封信。<br>This link expires in 30 minutes. If you didn't request this, please ignore this email.",
      }),
    });
    if (delivery === "suppressed") {
      logger.error("email delivery suppressed");
      return fail(503, { error: "Email delivery is unavailable" });
    }
  } catch (err) {
    logger.error("email send failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fail(500, { error: "Failed to send email" });
  }

  return { success: true };
});

export const handleClearNotificationEmailAction = withAction(async (event) => {
  const user = event.locals.user;
  if (!user) return fail(401, { error: "Unauthorized" });
  await notificationDomain.clearNotificationEmail(user.id);
  return { cleared: true };
});
