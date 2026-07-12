import bcrypt from "bcryptjs";
import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client";

const MIN_PASSWORD_LENGTH = 12;
const isProd = process.env.NODE_ENV === "production";

const adminEnvSchema = z.object({
  username: z
    .string()
    .min(1, "SEED_ADMIN_USERNAME is required to bootstrap the admin account."),
  email: z.string().min(1, "SEED_ADMIN_EMAIL is required to bootstrap the admin account."),
  password: z
    .string()
    .min(
      isProd ? MIN_PASSWORD_LENGTH : 1,
      isProd
        ? `SEED_ADMIN_PASSWORD must be at least ${String(MIN_PASSWORD_LENGTH)} characters in production.`
        : "SEED_ADMIN_PASSWORD is required to bootstrap the admin account.",
    ),
});

export function readSeedAdminEnv(): { username: string; email: string; password: string } {
  return adminEnvSchema.parse({
    username: process.env.SEED_ADMIN_USERNAME ?? "",
    email: process.env.SEED_ADMIN_EMAIL ?? "",
    password: process.env.SEED_ADMIN_PASSWORD ?? "",
  });
}

export async function seedAdmin(prisma: PrismaClient): Promise<string> {
  const { username, email, password } = readSeedAdminEnv();

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(
      `Admin "${username}" already exists (id=${existing.id}); leaving credentials untouched.`,
    );
    return existing.id;
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const admin = await prisma.user.create({
    data: {
      name: "Admin",
      email,
      username,
      platformRole: "admin",
      isSuperAdmin: true,
      emailVerified: true,
      mustChangePassword: true,
    },
  });

  await prisma.account.create({
    data: {
      id: `acct_${username}`,
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: passwordHash,
    },
  });

  console.log(
    `Bootstrapped admin "${username}" (id=${admin.id}). The provisioning password is single-use; first login forces a change.`,
  );
  return admin.id;
}
