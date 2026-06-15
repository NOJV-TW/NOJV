import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";

import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

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

function withDevFallback(value: string | undefined, fallback: string): string {
  if (value && value.length > 0) return value;
  return isProd ? "" : fallback;
}

async function main() {
  const { username, email, password } = adminEnvSchema.parse({
    username: withDevFallback(process.env.SEED_ADMIN_USERNAME, "admin"),
    email: withDevFallback(process.env.SEED_ADMIN_EMAIL, "admin@nojv.local"),
    password: withDevFallback(process.env.SEED_ADMIN_PASSWORD, "password123"),
  });

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(
      `Admin "${username}" already exists (id=${existing.id}); leaving credentials untouched.`,
    );
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const admin = await prisma.user.create({
    data: {
      name: "Admin",
      email,
      username,
      platformRole: "admin",
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
}

try {
  await main();
} catch (error) {
  console.error("Admin bootstrap failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
