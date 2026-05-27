import bcrypt from "bcryptjs";

import type { PrismaClient, User } from "../../generated/prisma/client";

const COURSE_ID = "course_os-lab-spring-2026";
const ROSTER_SIZE = 10;

/**
 * Create ~10 demo students (student01..student10) with credential accounts and
 * enroll them all into the OS Lab course as students. Idempotent: upserts on
 * username and on the (course, user) membership composite.
 */
export async function seedDemoStudents(
  prisma: PrismaClient,
  teacher: { id: string },
): Promise<User[]> {
  const passwordHash = bcrypt.hashSync("password123", 10);

  const students: User[] = [];

  for (let i = 1; i <= ROSTER_SIZE; i++) {
    const nn = String(i).padStart(2, "0");
    const username = `student${nn}`;

    const user = await prisma.user.upsert({
      create: {
        name: `學生 ${nn}`,
        email: `${username}@nojv.local`,
        username,
        platformRole: "student",
        status: "active",
        emailVerified: true,
      },
      update: {},
      where: { username },
    });

    await prisma.account.upsert({
      create: {
        id: `acct_${username}`,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      },
      update: { password: passwordHash },
      where: { id: `acct_${username}` },
    });

    await prisma.courseMembership.upsert({
      create: {
        addedByUserId: teacher.id,
        courseId: COURSE_ID,
        joinedAt: new Date(),
        role: "student",
        status: "active",
        userId: user.id,
      },
      update: {},
      where: {
        courseId_userId: {
          courseId: COURSE_ID,
          userId: user.id,
        },
      },
    });

    students.push(user);
  }

  console.log(`  Demo students: ${students.length} credentialed + enrolled in OS Lab`);
  return students;
}
