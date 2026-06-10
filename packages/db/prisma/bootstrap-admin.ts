import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const MIN_PASSWORD_LENGTH = 12;

function requiredEnv(name: string, fallbackDev?: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV !== "production" && fallbackDev !== undefined) {
    return fallbackDev;
  }
  throw new Error(`${name} is required to bootstrap the admin account.`);
}

async function main() {
  const username = requiredEnv("SEED_ADMIN_USERNAME", "admin");
  const email = requiredEnv("SEED_ADMIN_EMAIL", "admin@nojv.local");
  const password = requiredEnv("SEED_ADMIN_PASSWORD", "password123");

  if (password.length < MIN_PASSWORD_LENGTH && process.env.NODE_ENV === "production") {
    throw new Error(
      `SEED_ADMIN_PASSWORD must be at least ${String(MIN_PASSWORD_LENGTH)} characters in production.`,
    );
  }

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
