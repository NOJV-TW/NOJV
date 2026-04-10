import bcrypt from "bcryptjs";

import type { PrismaClient } from "../../generated/prisma/client";

export async function seedUsers(prisma: PrismaClient) {
  const passwordHash = bcrypt.hashSync("password123", 10);

  const admin = await prisma.user.upsert({
    create: {
      name: "Admin",
      email: "admin@nojv.local",
      username: "admin",
      id: "usr_admin",
      platformRole: "admin"
    },
    update: {},
    where: { id: "usr_admin" }
  });

  const teacher = await prisma.user.upsert({
    create: {
      name: "Teacher",
      email: "teacher@nojv.local",
      username: "teacher",
      id: "usr_teacher",
      platformRole: "teacher"
    },
    update: {},
    where: { id: "usr_teacher" }
  });

  const taStudent = await prisma.user.upsert({
    create: {
      name: "TA Student",
      email: "ta-student@nojv.local",
      username: "ta-student",
      id: "usr_ta_student",
      platformRole: "student"
    },
    update: {},
    where: { id: "usr_ta_student" }
  });

  const student = await prisma.user.upsert({
    create: {
      name: "Student",
      email: "student@nojv.local",
      username: "student",
      id: "usr_student",
      platformRole: "student"
    },
    update: {},
    where: { id: "usr_student" }
  });

  const users = [admin, teacher, taStudent, student];

  // --- Credential Accounts ---
  for (const u of users) {
    await prisma.account.upsert({
      create: {
        id: `acct_${u.username}`,
        accountId: u.id,
        providerId: "credential",
        userId: u.id,
        password: passwordHash
      },
      update: { password: passwordHash },
      where: { id: `acct_${u.username}` }
    });
  }

  console.log(`  Users: ${users.length} upserted with credential accounts`);

  return { admin, teacher, taStudent, student };
}
