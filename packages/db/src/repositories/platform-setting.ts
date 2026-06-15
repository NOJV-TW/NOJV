import { prisma } from "../client";

export const platformSettingRepo = {
  get(key: string) {
    return prisma.platformSetting.findUnique({ where: { key } });
  },

  set(key: string, value: string) {
    return prisma.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  },
};
