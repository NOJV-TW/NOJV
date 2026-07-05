import { fail } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { userDomain } from "@nojv/application";

import { createLogger } from "../logger";
import { getMailer } from "../mailer";
import { renderEmail } from "../mailer/template";
import { withAction } from "./action-handlers";
import { extractStudentId, parseSchoolEmail } from "$lib/utils/school";

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
  email: string,
): Promise<SchoolVerificationResult | SchoolVerificationError> {
  const parsed = parseSchoolEmail(email);
  if (!parsed) {
    return { error: "Invalid school email", status: 400 };
  }

  const username = extractStudentId(parsed.school, parsed.studentId);

  const result = await userDomain.initiateSchoolVerification(userId, username);

  if (result.status === "error") {
    return { error: result.detail, status: result.httpStatus };
  }

  if (!env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is required");

  const appUrl = env.BETTER_AUTH_URL;
  const verifyUrl = `${appUrl}/verify-school?token=${result.token}`;

  try {
    await getMailer().sendEmail({
      to: email,
      subject: "NOJV 學生帳號驗證 · Student Account Verification",
      html: renderEmail({
        heading: "NOJV 帳號驗證 · Account Verification",
        intro:
          "<p>請點擊下方按鈕前往驗證頁面並完成確認。</p><p>Click the button below to open the verification page and confirm.</p>",
        action: { url: verifyUrl, label: "驗證我的帳號 · Verify my account" },
        outro:
          "此連結將在 30 分鐘後失效。若您沒有申請此驗證，請忽略這封信。<br>This link expires in 30 minutes. If you didn't request this, please ignore this email.",
      }),
    });
  } catch (err) {
    logger.error("email send failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { error: "Failed to send email", status: 500 };
  }

  return { success: true };
}

export const handleSendVerificationAction = withAction(async (event) => {
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
});
