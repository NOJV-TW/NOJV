import { getRedis } from "@nojv/redis";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { seedContests } from "./seeds/contests";
import { seedCourses } from "./seeds/courses";
import { seedDemoStudents } from "./seeds/demo-students";
import { seedEngagement } from "./seeds/engagement";
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
  await seedProblems(prisma, teacher.id);
  await seedContests(prisma);
  await seedCourses(prisma, { teacher, taStudent, student });
  const demoStudents = await seedDemoStudents(prisma, teacher);
  await seedSubmissions(prisma, { student, demoStudents });
  await seedEngagement(prisma, { teacher, student, demoStudents });

  await prisma.announcement.deleteMany();

  const announcementSeeds: Array<{
    pinned: boolean;
    translations: Array<{ locale: string; title: string; content: string }>;
  }> = [
    {
      pinned: true,
      translations: [
        {
          locale: "zh-TW",
          title: "系統上線公告",
          content: "NOJV 線上評測系統已正式上線，歡迎使用！",
        },
      ],
    },
    {
      pinned: false,
      translations: [
        {
          locale: "zh-TW",
          title: "新功能：課程管理",
          content: "教師現在可以建立課程、新增作業與考試。學生可以透過加入碼加入課程。",
        },
      ],
    },
    {
      pinned: false,
      translations: [
        {
          locale: "zh-TW",
          title: "系統維護通知",
          content: "預計於本週六 22:00-24:00 進行系統維護，届時服務將暫停。",
        },
      ],
    },
  ];

  const publishedAt = new Date();
  for (const seed of announcementSeeds) {
    await prisma.announcement.create({
      data: {
        pinned: seed.pinned,
        status: "published",
        audience: "all",
        publishedAt,
        createdByUserId: admin.id,
        translations: {
          create: seed.translations,
        },
      },
    });
  }
  console.log(`Seeded announcements: ${announcementSeeds.length}`);

  console.log("Seed complete.");
}

try {
  await main();
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await getRedis().quit();
}
