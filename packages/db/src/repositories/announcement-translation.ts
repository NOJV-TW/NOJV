import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const announcementTranslationRepo = {
  findByAnnouncementId(announcementId: string) {
    return prisma.announcementTranslation.findMany({
      where: { announcementId },
      orderBy: { locale: "asc" }
    });
  },

  findByLocale(announcementId: string, locale: string) {
    return prisma.announcementTranslation.findUnique({
      where: { announcementId_locale: { announcementId, locale } }
    });
  },

  upsert(announcementId: string, locale: string, data: { title: string; content: string }) {
    return prisma.announcementTranslation.upsert({
      where: { announcementId_locale: { announcementId, locale } },
      create: { announcementId, locale, title: data.title, content: data.content },
      update: { title: data.title, content: data.content }
    });
  },

  delete(announcementId: string, locale: string) {
    return prisma.announcementTranslation.delete({
      where: { announcementId_locale: { announcementId, locale } }
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.AnnouncementTranslationUncheckedCreateInput) {
        return tx.announcementTranslation.create({ data });
      },

      deleteByAnnouncementId(announcementId: string) {
        return tx.announcementTranslation.deleteMany({
          where: { announcementId }
        });
      },

      upsert(announcementId: string, locale: string, data: { title: string; content: string }) {
        return tx.announcementTranslation.upsert({
          where: { announcementId_locale: { announcementId, locale } },
          create: {
            announcementId,
            locale,
            title: data.title,
            content: data.content
          },
          update: { title: data.title, content: data.content }
        });
      }
    };
  }
};
