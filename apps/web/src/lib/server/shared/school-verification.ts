import { randomBytes } from "crypto";

import { Resend } from "resend";
import { prisma } from "@nojv/db";

import { createLogger } from "../logger";
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

  // Check if username is already taken by another user
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing && existing.id !== userId) {
    return { error: "Username already taken", status: 409 };
  }

  // Generate verification token (stored in Verification table)
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await prisma.verification.create({
    data: {
      id: token,
      identifier: userId,
      value: JSON.stringify({
        email,
        username,
        school: parsed.school,
        studentId: parsed.studentId
      }),
      expiresAt
    }
  });

  if (!process.env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is required");
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required");
  if (!process.env.EMAIL_FROM_DOMAIN) throw new Error("EMAIL_FROM_DOMAIN is required");

  const appUrl = process.env.BETTER_AUTH_URL;
  const verifyUrl = `${appUrl}/verify-school?token=${token}`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: `NOJV <noreply@${process.env.EMAIL_FROM_DOMAIN}>`,
    to: email,
    subject: "NOJV 學生帳號驗證",
    html: `
      <h2>NOJV 帳號驗證</h2>
      <p>請點擊以下連結完成學生帳號驗證：</p>
      <p><a href="${verifyUrl}">驗證我的帳號</a></p>
      <p>此連結將在 30 分鐘後失效。</p>
      <p>如果您沒有申請此驗證，請忽略這封信。</p>
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
