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

  // Placeholder user exercising the Task 1.5 bulk-handle flow. Teachers
  // paste handles; unknown handles become `pending_first_login` rows
  // with a synthetic email that `attachPlaceholderToAuth` later
  // replaces on the student's first OAuth login. Kept out of any
  // CourseMembership so the `b11902999` handle is claimable by a real
  // login without going through the merge path.
  const placeholderUsername = "b11902999";
  const placeholder = await prisma.user.upsert({
    create: {
      name: placeholderUsername,
      displayUsername: placeholderUsername,
      email: `placeholder+${placeholderUsername}@placeholder.nojv.local`,
      username: placeholderUsername,
      id: "usr_placeholder_b11902999",
      platformRole: "student",
      status: "pending_first_login",
      emailVerified: false
    },
    update: {},
    where: { id: "usr_placeholder_b11902999" }
  });

  // Credentialed users (placeholder is intentionally NOT in this list
  // — it has no Account row and cannot sign in until a real OAuth
  // signup attaches to it via `attachPlaceholderToAuth`).
  const credentialedUsers = [admin, teacher, taStudent, student];

  for (const u of credentialedUsers) {
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

  console.log(
    `  Users: ${credentialedUsers.length} credentialed + 1 pending_first_login placeholder upserted`
  );

  return { admin, teacher, taStudent, student, placeholder };
}
