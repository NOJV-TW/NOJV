import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { userMiniSelect, userScoreboardSelect } from "./selects";

type TxClient = TransactionClient;

export class UnifiedParticipationVersionConflict extends Error {
  readonly participationId: string;
  readonly expectedVersion: number;

  constructor(participationId: string, expectedVersion: number) {
    super(
      `Participation ${participationId} version ${String(expectedVersion)} no longer current.`,
    );
    this.name = "UnifiedParticipationVersionConflict";
    this.participationId = participationId;
    this.expectedVersion = expectedVersion;
  }
}

export const participationRepo = {
  findById(id: string) {
    return prisma.participation.findUnique({ where: { id } });
  },

  async updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Prisma.ParticipationUpdateInput,
  ) {
    try {
      return await prisma.participation.update({
        data: { ...data, version: { increment: 1 } },
        where: { id, version: expectedVersion },
      });
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === "P2025") {
        throw new UnifiedParticipationVersionConflict(id, expectedVersion);
      }
      throw err;
    }
  },

  findContestParticipation(contestId: string, userId: string) {
    return prisma.participation.findUnique({
      where: { type_contestId_userId: { type: "contest", contestId, userId } },
    });
  },

  async findContestForScoring(contestId: string, userId: string) {
    const row = await prisma.participation.findUnique({
      where: { type_contestId_userId: { type: "contest", contestId, userId } },
      include: { contest: { include: { problems: { orderBy: { ordinal: "asc" } } } } },
    });
    if (!row?.contest) return null;
    return { ...row, contest: row.contest };
  },

  findContestScoreboardParticipants(contestId: string) {
    return prisma.participation.findMany({
      where: { type: "contest", contestId, status: { in: ["active", "submitted"] } },
      select: { userId: true, user: { select: userScoreboardSelect } },
    });
  },

  listContestParticipantUserIds(contestId: string) {
    return prisma.participation
      .findMany({ where: { type: "contest", contestId }, select: { userId: true } })
      .then((rows) => rows.map((r) => r.userId));
  },

  listContestParticipantsWithUser(contestId: string) {
    return prisma.participation.findMany({
      where: { type: "contest", contestId },
      include: { user: { select: userMiniSelect } },
      orderBy: [{ user: { username: "asc" } }],
    });
  },

  findExamParticipation(examId: string, userId: string) {
    return prisma.participation.findUnique({
      where: { type_examId_userId: { type: "exam", examId, userId } },
    });
  },

  async findExamForScoring(examId: string, userId: string) {
    const row = await prisma.participation.findUnique({
      where: { type_examId_userId: { type: "exam", examId, userId } },
      include: { exam: { include: { problems: { orderBy: { ordinal: "asc" } } } } },
    });
    if (!row?.exam) return null;
    return { ...row, exam: row.exam };
  },

  findExamScoreboardParticipants(examId: string) {
    return prisma.participation.findMany({
      where: { type: "exam", examId, status: { in: ["active", "submitted"] } },
      select: { userId: true, user: { select: userScoreboardSelect } },
    });
  },

  listExamParticipantsWithUser(examId: string) {
    return prisma.participation.findMany({
      where: { type: "exam", examId },
      include: { user: { select: userMiniSelect } },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });
  },

  listExamParticipantUserIds(examId: string) {
    return prisma.participation
      .findMany({ where: { type: "exam", examId }, select: { userId: true } })
      .then((rows) => rows.map((r) => r.userId));
  },

  async findVirtualById(id: string) {
    const row = await prisma.participation.findFirst({ where: { id, type: "virtual" } });
    if (!row?.endsAt || !row.startedAt) return null;
    return { ...row, startedAt: row.startedAt, endsAt: row.endsAt };
  },

  async findVirtual(contestId: string, userId: string) {
    const row = await prisma.participation.findUnique({
      where: { type_contestId_userId: { type: "virtual", contestId, userId } },
    });
    if (!row?.endsAt || !row.startedAt) return null;
    return { ...row, startedAt: row.startedAt, endsAt: row.endsAt };
  },

  async createVirtual(input: {
    contestId: string;
    userId: string;
    startedAt: Date;
    endsAt: Date;
  }) {
    const row = await prisma.participation.create({
      data: {
        type: "virtual",
        contestId: input.contestId,
        userId: input.userId,
        status: "active",
        startedAt: input.startedAt,
        endsAt: input.endsAt,
      },
    });
    return {
      ...row,
      startedAt: row.startedAt ?? input.startedAt,
      endsAt: row.endsAt ?? input.endsAt,
    };
  },

  withTx(tx: TxClient) {
    return {
      upsertContestActive(contestId: string, userId: string, startedAt: Date) {
        return tx.participation.upsert({
          where: { type_contestId_userId: { type: "contest", contestId, userId } },
          create: { type: "contest", contestId, userId, status: "active", startedAt },
          update: { status: "active" },
        });
      },

      findExamParticipation(examId: string, userId: string) {
        return tx.participation.findUnique({
          where: { type_examId_userId: { type: "exam", examId, userId } },
        });
      },

      upsertExamActive(
        examId: string,
        userId: string,
        activateOnEntry: boolean,
        startedAt: Date,
      ) {
        return tx.participation.upsert({
          where: { type_examId_userId: { type: "exam", examId, userId } },
          create: { type: "exam", examId, userId, status: "active", startedAt },
          update: activateOnEntry ? { status: "active" } : {},
        });
      },

      findExamIpPin(examId: string, userId: string) {
        return tx.participation.findUnique({
          select: { id: true, ipPin: true, ipGateExemptUntil: true },
          where: { type_examId_userId: { type: "exam", examId, userId } },
        });
      },

      updateExamIpPin(id: string, ip: string) {
        return tx.participation.update({ where: { id }, data: { ipPin: ip } });
      },

      clearExamPinAndExempt(examId: string, userId: string, exemptUntil: Date) {
        return tx.participation.update({
          where: { type_examId_userId: { type: "exam", examId, userId } },
          data: { ipPin: null, ipGateExemptUntil: exemptUntil },
        });
      },
    };
  },
};
