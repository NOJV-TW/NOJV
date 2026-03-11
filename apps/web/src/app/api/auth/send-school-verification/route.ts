import { randomBytes } from "crypto";

import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";

import { prisma } from "@nojv/db";

import { auth } from "@/lib/auth";
import { extractStudentId, parseSchoolEmail } from "@/lib/school-verification";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { email?: string };
  const email = typeof body.email === "string" ? body.email.trim() : "";

  const parsed = parseSchoolEmail(email);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid school email" }, { status: 400 });
  }

  const handle = extractStudentId(parsed.school, parsed.studentId);

  // Check if handle is already taken by another user
  const existing = await prisma.user.findUnique({ where: { handle } });
  if (existing && existing.id !== session.user.id) {
    return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
  }

  // Generate verification token (stored in Verification table)
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await prisma.verification.create({
    data: {
      id: token,
      identifier: session.user.id,
      value: JSON.stringify({ email, handle, school: parsed.school, studentId: parsed.studentId }),
      expiresAt
    }
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const verifyUrl = `${appUrl}/api/auth/verify-school?token=${token}`;

  const { data, error } = await resend.emails.send({
    from: `NOJV <noreply@${process.env.EMAIL_FROM_DOMAIN}>`,
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
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
