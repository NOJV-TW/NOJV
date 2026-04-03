import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

const contestListInclude = {
  _count: { select: { participations: true, problems: true } }
} as const;

export const contestRepo = {
  findById(id: string) {
    return prisma.contest.findUnique({ where: { id } });
  },

  findBySlug(slug: string) {
    return prisma.contest.findUnique({ where: { slug } });
  },

  /** Find contest by ID with course slug (plagiarism). */
  findByIdWithCourseSlug(id: string) {
    return prisma.contest.findUnique({
      where: { id },
      select: { course: { select: { slug: true } }, courseId: true, id: true }
    });
  },


  findByIdOrThrow(id: string, select?: Prisma.ContestSelect) {
    return prisma.contest.findUniqueOrThrow({
      ...(select ? { select } : {}),
      where: { id }
    });
  },

  findByInviteCode(inviteCode: string) {
    return prisma.contest.findUnique({
      where: { inviteCode },
      select: { courseId: true, slug: true, visibility: true }
    });
  },

  findAllowedLanguages(slug: string) {
    return prisma.contest.findUnique({
      where: { slug },
      select: { allowedLanguages: true }
    });
  },

  /** List public contests with counts. */
  listPublished() {
    return prisma.contest.findMany({
      include: contestListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId: null,
        visibility: "published"
      }
    });
  },

  /** List contests for a course. */
  listByCourseSlug(courseSlug: string) {
    return prisma.contest.findMany({
      include: contestListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        course: { slug: courseSlug },
        visibility: "published"
      }
    });
  },

  /** Fetch contest detail with problems and participant count. */
  findDetailBySlug(slug: string) {
    return prisma.contest.findUnique({
      include: {
        _count: { select: { participations: true } },
        course: { select: { slug: true } },
        problems: {
          include: {
            problem: { select: { defaultTitle: true, slug: true } }
          },
          orderBy: { ordinal: "asc" }
        }
      },
      where: { slug }
    });
  },

  /** Fetch contest workspace data including user participation. */
  findWorkspaceBySlug(slug: string, userId: string) {
    return prisma.contest.findUnique({
      include: {
        _count: { select: { participations: true } },
        course: { select: { slug: true } },
        participations: {
          where: { userId },
          take: 1
        },
        problems: {
          include: {
            problem: { select: { defaultTitle: true, slug: true } }
          },
          orderBy: { ordinal: "asc" }
        }
      },
      where: { slug }
    });
  },

  /** Fetch contest with scoreboard data (problems + active participants). */
  findForScoreboard(slug: string) {
    return prisma.contest.findUnique({
      include: {
        problems: {
          include: { problem: { select: { defaultTitle: true, slug: true } } },
          orderBy: { ordinal: "asc" }
        },
        participations: {
          include: {
            user: { select: { displayUsername: true, username: true, name: true } }
          },
          where: { status: { in: ["active", "submitted"] } }
        }
      },
      where: { slug }
    });
  },

  /** Fetch contest with participations for chart data. */
  findForChart(slug: string, userIds: string[]) {
    return prisma.contest.findUnique({
      select: {
        startsAt: true,
        participations: {
          where: { userId: { in: userIds } },
          select: { id: true, userId: true }
        }
      },
      where: { slug }
    });
  },

  /** Fetch contest info for temporal activities. */
  findInfoById(id: string) {
    return prisma.contest.findUniqueOrThrow({
      select: {
        endsAt: true,
        frozenAt: true,
        scoringMode: true,
        startsAt: true
      },
      where: { id }
    });
  },

  /** Find active page-locked contest for a user. */
  findPageLockedForUser(userId: string, now: Date) {
    return prisma.contest.findFirst({
      where: {
        pageLockEnabled: true,
        visibility: "published",
        startsAt: { lte: now },
        endsAt: { gte: now },
        participations: {
          some: { userId, status: "active" }
        }
      },
      select: {
        slug: true,
        course: { select: { slug: true } }
      }
    });
  },

  /** Find a participation record for IP lock checks. */
  findParticipation(contestId: string, userId: string) {
    return prisma.contestParticipation.findUnique({
      select: { id: true, boundIp: true },
      where: {
        contestId_userId: { contestId, userId }
      }
    });
  },

  count() {
    return prisma.contest.count();
  },

  update(id: string, data: Prisma.ContestUpdateInput) {
    return prisma.contest.update({
      data,
      where: { id }
    });
  },

  /** Run raw query for DB health check. */
  healthCheck() {
    return prisma.$queryRaw`SELECT 1`;
  },

  // ── Transaction variants ──

  withTx(tx: TxClient) {
    return {
      findBySlug(slug: string) {
        return tx.contest.findUnique({ where: { slug } });
      },

      create(data: Prisma.ContestUncheckedCreateInput) {
        return tx.contest.create({ data });
      },

      update(id: string, data: Prisma.ContestUncheckedUpdateInput) {
        return tx.contest.update({
          data,
          where: { id }
        });
      }
    };
  }
};

export const contestProblemRepo = {
  withTx(tx: TxClient) {
    return {
      create(data: Prisma.ContestProblemUncheckedCreateInput) {
        return tx.contestProblem.create({ data });
      },

      deleteByContestId(contestId: string) {
        return tx.contestProblem.deleteMany({
          where: { contestId }
        });
      }
    };
  }
};

export const contestParticipationRepo = {
  findByIdWithContest(id: string) {
    return prisma.contestParticipation.findUnique({
      include: {
        contest: {
          include: {
            problems: { orderBy: { ordinal: "asc" } }
          }
        }
      },
      where: { id }
    });
  },

  update(id: string, data: Prisma.ContestParticipationUpdateInput) {
    return prisma.contestParticipation.update({
      data,
      where: { id }
    });
  },

  withTx(tx: TxClient) {
    return {
      upsert(
        contestId: string,
        userId: string,
        createData: Prisma.ContestParticipationUncheckedCreateInput,
        updateData: Prisma.ContestParticipationUncheckedUpdateInput
      ) {
        return tx.contestParticipation.upsert({
          create: createData,
          update: updateData,
          where: {
            contestId_userId: { contestId, userId }
          }
        });
      },

      findByContestAndUser(contestId: string, userId: string) {
        return tx.contestParticipation.findUnique({
          where: { contestId_userId: { contestId, userId } }
        });
      }
    };
  }
};
