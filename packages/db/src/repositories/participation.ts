import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { userScoreboardSelect } from "./selects";

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
  create(data: Prisma.ParticipationCreateInput) {
    return prisma.participation.create({ data });
  },

  findById(id: string) {
    return prisma.participation.findUnique({ where: { id } });
  },

  findContestParticipation(contestId: string, userId: string) {
    return prisma.participation.findFirst({
      where: { type: "contest", contestId, userId },
    });
  },

  findContestScoreboardParticipants(contestId: string) {
    return prisma.participation.findMany({
      where: { type: "contest", contestId, status: { in: ["active", "submitted"] } },
      select: { userId: true, user: { select: userScoreboardSelect } },
    });
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
};
