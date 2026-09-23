import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { seedContests } from "./seeds/contests";
import { seedCourses } from "./seeds/courses";
import { seedDemoStudents } from "./seeds/demo-students";
import { seedEngagement } from "./seeds/engagement";
import { seedAnnouncements } from "./seeds/announcements";
import { seedProblems } from "./seeds/problems";
import { seedSubmissions } from "./seeds/submissions";
import { seedUsers } from "./seeds/users";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    throw new Error(
      "Refusing to run the demo seed in production. It inserts password123 test accounts and wipes announcements. Use `db:bootstrap-admin` to provision a production admin, or set ALLOW_PROD_SEED=true to override.",
    );
  }

  console.log("Seeding database...");

  const { admin, teacher, taStudent, student } = await seedUsers(prisma);
  await seedProblems(prisma, teacher.id, {
    advancedDemoImages: {
      run: "nojv-demo-advanced-run:local",
      grade: "nojv-demo-advanced-grade:local",
    },
  });
  await seedContests(prisma);
  await seedCourses(prisma, { teacher, taStudent, student });
  const demoStudents = await seedDemoStudents(prisma, teacher);
  await seedSubmissions(prisma, { admin, teacher, student, demoStudents });
  await seedEngagement(prisma, { teacher, student, demoStudents });
  await seedAnnouncements(prisma, admin);

  console.log("Seed complete.");
}

try {
  await main();
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
