import { z } from "zod";
import { prisma } from "@nojv/db";

import type { PageServerLoad } from "./$types";

const verificationDataSchema = z.object({ username: z.string().min(1) });

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get("token");

  if (!token) {
    return { status: "error" as const, detail: "缺少驗證 token" };
  }

  const record = await prisma.verification.findUnique({ where: { id: token } });

  if (!record || record.expiresAt < new Date()) {
    // Clean up expired token
    if (record) {
      await prisma.verification.delete({ where: { id: token } });
    }
    return { status: "error" as const, detail: "驗證連結已過期或無效" };
  }

  const parsed = verificationDataSchema.safeParse(JSON.parse(record.value));

  if (!parsed.success) {
    await prisma.verification.delete({ where: { id: token } });
    return { status: "error" as const, detail: "驗證資料格式錯誤" };
  }

  const data = parsed.data;

  // Check username not taken by someone else
  const existing = await prisma.user.findUnique({ where: { username: data.username } });
  if (existing && existing.id !== record.identifier) {
    await prisma.verification.delete({ where: { id: token } });
    return { status: "error" as const, detail: "此學號已被其他帳號使用" };
  }

  // Update user username
  await prisma.user.update({
    where: { id: record.identifier },
    data: { username: data.username, displayUsername: data.username }
  });

  // Delete used token
  await prisma.verification.delete({ where: { id: token } });

  return { status: "success" as const, username: data.username };
};
