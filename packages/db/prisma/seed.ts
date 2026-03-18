import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { seedContests } from "./seeds/contests";
import { seedCourses } from "./seeds/courses";
import { seedProblems } from "./seeds/problems";
import { seedUsers } from "./seeds/users";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  const { teacher, taStudent, student } = await seedUsers(prisma);
  await seedProblems(prisma, teacher.id);
  await seedContests(prisma);
  await seedCourses(prisma, { teacher, taStudent, student });

  // Seed announcements
  await prisma.announcement.deleteMany();
  await prisma.announcement.createMany({
    data: [
      {
        title: "系統上線公告",
        content: "NOJV 線上評測系統已正式上線，歡迎使用！",
        pinned: true
      },
      {
        title: "新功能：課程管理",
        content: "教師現在可以建立課程、新增作業與考試。學生可以透過加入碼加入課程。",
        pinned: false
      },
      {
        title: "系統維護通知",
        content: "預計於本週六 22:00-24:00 進行系統維護，届時服務將暫停。",
        pinned: false
      }
    ]
  });
  console.log("Seeded announcements");

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
