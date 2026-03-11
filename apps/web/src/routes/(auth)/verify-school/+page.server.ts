import { prisma } from "@nojv/db";

import type { PageServerLoad } from "./$types";

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

  const data = JSON.parse(record.value) as { handle: string };

  // Check handle not taken by someone else
  const existing = await prisma.user.findUnique({ where: { handle: data.handle } });
  if (existing && existing.id !== record.identifier) {
    await prisma.verification.delete({ where: { id: token } });
    return { status: "error" as const, detail: "此學號已被其他帳號使用" };
  }

  // Update user handle
  await prisma.user.update({
    where: { id: record.identifier },
    data: { handle: data.handle, displayHandle: data.handle }
  });

  // Delete used token
  await prisma.verification.delete({ where: { id: token } });

  return { status: "success" as const, handle: data.handle };
};
