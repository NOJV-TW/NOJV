import { randomBytes } from "crypto";

import { fail, redirect } from "@sveltejs/kit";
import { Resend } from "resend";

import { prisma } from "@nojv/db";

import { extractStudentId, isReservedHandle, parseSchoolEmail } from "$lib/school";
import { readHandleFromAuthUser, readStringValue } from "$lib/server/auth";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/");
  }

  const user = locals.user as Record<string, unknown>;
  const rawHandle = readHandleFromAuthUser(user);
  const handle = rawHandle ?? "\u2014";
  const platformRole = readStringValue(user.platformRole) ?? "student";
  const isSchoolVerified = rawHandle !== null && isReservedHandle(rawHandle);

  return {
    email: locals.user.email,
    handle,
    isSchoolVerified,
    name: locals.user.name,
    platformRole
  };
};

export const actions = {
  sendVerification: async ({ locals, request }) => {
    const user = locals.user;
    if (!user) {
      return fail(401, { error: "Unauthorized" });
    }

    const formData = await request.formData();
    const email = (formData.get("email") as string | null)?.trim() ?? "";

    const parsed = parseSchoolEmail(email);
    if (!parsed) {
      return fail(400, { error: "Invalid school email" });
    }

    const handle = extractStudentId(parsed.school, parsed.studentId);

    // Check if handle is already taken by another user
    const existing = await prisma.user.findUnique({ where: { handle } });
    if (existing && existing.id !== user.id) {
      return fail(409, { error: "Handle already taken" });
    }

    // Generate verification token (stored in Verification table)
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await prisma.verification.create({
      data: {
        id: token,
        identifier: user.id,
        value: JSON.stringify({ email, handle, school: parsed.school, studentId: parsed.studentId }),
        expiresAt
      }
    });

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const verifyUrl = `${appUrl}/verify-school?token=${token}`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: `NOJV <noreply@${process.env.EMAIL_FROM_DOMAIN ?? ""}>`,
      to: email,
      subject: "NOJV 三校聯盟帳號驗證",
      html: `
        <h2>NOJV 帳號驗證</h2>
        <p>請點擊以下連結完成三校聯盟帳號驗證：</p>
        <p><a href="${verifyUrl}">驗證我的帳號</a></p>
        <p>此連結將在 30 分鐘後失效。</p>
        <p>如果您沒有申請此驗證，請忽略這封信。</p>
      `
    });

    if (error) {
      console.error("Resend error:", error);
      return fail(500, { error: "Failed to send email" });
    }

    return { success: true };
  }
} satisfies Actions;
