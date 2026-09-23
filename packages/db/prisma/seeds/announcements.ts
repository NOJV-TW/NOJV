import type { PrismaClient, User } from "../../generated/prisma/client";

const announcementSeeds = [
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
] as const;

export async function seedAnnouncements(prisma: PrismaClient, admin: User): Promise<void> {
  await prisma.announcement.deleteMany();

  const publishedAt = new Date();
  for (const seed of announcementSeeds) {
    await prisma.announcement.create({
      data: {
        pinned: seed.pinned,
        status: "published",
        audience: "all",
        publishedAt,
        createdByUserId: admin.id,
        translations: { create: seed.translations },
      },
    });
  }
  console.log(`Seeded announcements: ${announcementSeeds.length}`);
}
