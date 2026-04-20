import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { seedContests } from "./seeds/contests";
import { seedCourses } from "./seeds/courses";
import { seedProblems } from "./seeds/problems";
import { seedUsers } from "./seeds/users";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  const { admin, teacher, taStudent, student } = await seedUsers(prisma);
  await seedProblems(prisma, teacher.id);
  await seedContests(prisma);
  await seedCourses(prisma, { teacher, taStudent, student });

  // Seed announcements. Title/content now live on AnnouncementTranslation;
  // the parent row carries lifecycle (status/audience/publishedAt).
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

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
