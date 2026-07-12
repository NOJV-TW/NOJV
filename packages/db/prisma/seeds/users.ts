import bcrypt from "bcryptjs";

import type { PrismaClient } from "../../generated/prisma/client";

export async function seedUsers(prisma: PrismaClient) {
  const passwordHash = bcrypt.hashSync("password123", 10);

  const admin = await prisma.user.upsert({
    create: {
      name: "Admin",
      email: "admin@nojv.local",
      username: "admin",
      platformRole: "admin",
      isSuperAdmin: true,
    },
    update: { isSuperAdmin: true },
    where: { username: "admin" },
  });

  const teacher = await prisma.user.upsert({
    create: {
      name: "Teacher",
      email: "teacher@nojv.local",
      username: "teacher",
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    },
    update: { canCreateAdvancedProblems: true },
    where: { username: "teacher" },
  });

  const taStudent = await prisma.user.upsert({
    create: {
      name: "TA Student",
      email: "ta-student@nojv.local",
      username: "ta-student",
      platformRole: "student",
    },
    update: {},
    where: { username: "ta-student" },
  });

  const student = await prisma.user.upsert({
    create: {
      name: "Student",
      email: "student@nojv.local",
      username: "student",
      platformRole: "student",
    },
    update: {},
    where: { username: "student" },
  });

  const newStudent = await prisma.user.upsert({
    create: {
      name: "New Student",
      email: "new-student@nojv.local",
      username: "new-student",
      platformRole: "student",
    },
    update: {},
    where: { username: "new-student" },
  });

  const placeholderUsername = "b11902999";
  const placeholder = await prisma.user.upsert({
    create: {
      name: placeholderUsername,
      displayUsername: placeholderUsername,
      email: `placeholder+${placeholderUsername}@placeholder.nojv.local`,
      username: placeholderUsername,
      platformRole: "student",
      status: "pending_first_login",
      emailVerified: false,
    },
    update: {},
    where: { username: placeholderUsername },
  });

  const credentialedUsers = [admin, teacher, taStudent, student, newStudent];

  for (const u of credentialedUsers) {
    await prisma.account.upsert({
      create: {
        id: `acct_${u.username}`,
        accountId: u.id,
        providerId: "credential",
        userId: u.id,
        password: passwordHash,
      },
      update: {},
      where: { id: `acct_${u.username}` },
    });
  }

  console.log(
    `  Users: ${credentialedUsers.length} credentialed + 1 pending_first_login placeholder upserted`,
  );

  return { admin, teacher, taStudent, student, newStudent, placeholder };
}
