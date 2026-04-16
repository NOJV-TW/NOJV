import { fail, type RequestEvent } from "@sveltejs/kit";
import { Resend } from "resend";
import { env } from "$env/dynamic/private";
import { userDomain } from "@nojv/domain";

import { createLogger } from "../logger";
import { consumeFormRateLimit } from "./rate-limiter";
import { extractStudentId, parseSchoolEmail } from "$lib/school";

const logger = createLogger("school-verification");

export interface SchoolVerificationResult {
  success: true;
}

export interface SchoolVerificationError {
  error: string;
  status: 400 | 409 | 500;
}

export async function processSchoolVerification(
  userId: string,
  email: string
): Promise<SchoolVerificationResult | SchoolVerificationError> {
  const parsed = parseSchoolEmail(email);
  if (!parsed) {
    return { error: "Invalid school email", status: 400 };
  }

  const username = extractStudentId(parsed.school, parsed.studentId);

  // The token row stores `username` directly now — no opaque payload
  // is encoded into the better-auth Verification record any more.
  const result = await userDomain.initiateSchoolVerification(userId, username);

  if (result.status === "error") {
    return { error: result.detail, status: result.httpStatus };
  }

  if (!env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is required");
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required");
  if (!env.EMAIL_FROM_DOMAIN) throw new Error("EMAIL_FROM_DOMAIN is required");

  const appUrl = env.BETTER_AUTH_URL;
  const verifyUrl = `${appUrl}/verify-school?token=${result.token}`;

  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: `NOJV <noreply@${env.EMAIL_FROM_DOMAIN}>`,
    to: email,
    subject: "NOJV 學生帳號驗證",
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a">
        <h2 style="margin-bottom:16px">NOJV 帳號驗證</h2>
        <p style="margin-bottom:24px;line-height:1.6">請點擊下方按鈕完成學生帳號驗證：</p>
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 32px;background-color:#2563eb;color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px">
          驗證我的帳號
        </a>
        <p style="margin-top:24px;font-size:13px;color:#6b7280">此連結將在 30 分鐘後失效。</p>
        <p style="font-size:13px;color:#6b7280">如果您沒有申請此驗證，請忽略這封信。</p>
      </div>
    `
  });

  if (error) {
    logger.error("email send failed", {
      err: error.message
    });
    return { error: "Failed to send email", status: 500 };
  }

  return { success: true };
}

// Shared form action handler for the "send school verification email"
// button. /account and /complete-profile both POST to ?/sendVerification
// with identical semantics, so both routes alias this single handler.
export async function handleSendVerificationAction(event: RequestEvent) {
  const limited = await consumeFormRateLimit(event);
  if (limited) return limited;

  const user = event.locals.user;
  if (!user) {
    return fail(401, { error: "Unauthorized" });
  }

  const formData = await event.request.formData();
  const email = ((formData.get("email") as string | null) ?? "").trim();
  const result = await processSchoolVerification(user.id, email);

  if ("error" in result) {
    return fail(result.status, { error: result.error });
  }

  return { success: true };
}
