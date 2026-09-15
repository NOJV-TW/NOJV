import { prisma } from "../client";
import type { Prisma, ProblemPublicationRequestStatus } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

const publicationRequestInclude = {
  problem: {
    select: {
      id: true,
      displayId: true,
      title: true,
      authorId: true,
      visibility: true,
      status: true,
      author: { select: { id: true, username: true, name: true } },
    },
  },
  requestedBy: { select: { id: true, username: true, name: true } },
  reviewedBy: { select: { id: true, username: true, name: true } },
  publishedProblem: { select: { id: true, displayId: true, title: true } },
} as const satisfies Prisma.ProblemPublicationRequestInclude;

export type ProblemPublicationRequestRow = Prisma.ProblemPublicationRequestGetPayload<{
  include: typeof publicationRequestInclude;
}>;

export interface CreatePendingProblemPublicationRequestInput {
  problemId: string;
  requestedByUserId: string;
}

export interface ApproveProblemPublicationRequestInput {
  publishedProblemId: string;
  reviewedByUserId: string;
  reviewedAt?: Date;
}

export interface RejectProblemPublicationRequestInput {
  reviewedByUserId: string;
  reviewNote?: string | null;
  reviewedAt?: Date;
}

type RequestClient = Pick<TransactionClient, "$queryRaw" | "problemPublicationRequest">;

function listArgs(opts: {
  status?: ProblemPublicationRequestStatus;
  limit: number;
  cursor?: string;
}): Prisma.ProblemPublicationRequestFindManyArgs {
  return {
    where: opts.status ? { status: opts.status } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: publicationRequestInclude,
  };
}

export const problemPublicationRequestRepo = {
  findById(id: string) {
    return prisma.problemPublicationRequest.findUnique({
      where: { id },
      include: publicationRequestInclude,
    });
  },

  findPendingByProblemId(problemId: string) {
    return prisma.problemPublicationRequest.findFirst({
      where: { problemId, status: "pending" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: publicationRequestInclude,
    });
  },

  findLatestByProblemId(problemId: string) {
    return prisma.problemPublicationRequest.findFirst({
      where: { problemId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: publicationRequestInclude,
    });
  },

  listPaged(opts: {
    status?: ProblemPublicationRequestStatus;
    limit: number;
    cursor?: string;
  }): Promise<ProblemPublicationRequestRow[]> {
    return prisma.problemPublicationRequest.findMany(listArgs(opts)) as Promise<
      ProblemPublicationRequestRow[]
    >;
  },

  createPending(input: CreatePendingProblemPublicationRequestInput) {
    return prisma.problemPublicationRequest.create({
      data: {
        problemId: input.problemId,
        requestedByUserId: input.requestedByUserId,
        status: "pending",
      },
    });
  },

  withTx(tx: RequestClient) {
    return {
      findById(id: string) {
        return tx.problemPublicationRequest.findUnique({
          where: { id },
          include: publicationRequestInclude,
        });
      },

      findPendingByProblemId(problemId: string) {
        return tx.problemPublicationRequest.findFirst({
          where: { problemId, status: "pending" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: publicationRequestInclude,
        });
      },

      createPending(input: CreatePendingProblemPublicationRequestInput) {
        return tx.problemPublicationRequest.create({
          data: {
            problemId: input.problemId,
            requestedByUserId: input.requestedByUserId,
            status: "pending",
          },
          include: publicationRequestInclude,
        });
      },

      lockById(id: string) {
        return tx.$queryRaw`SELECT id FROM "ProblemPublicationRequest" WHERE id = ${id} FOR UPDATE`;
      },

      approve(id: string, input: ApproveProblemPublicationRequestInput) {
        return tx.problemPublicationRequest.update({
          where: { id },
          data: {
            status: "approved",
            publishedProblemId: input.publishedProblemId,
            reviewedByUserId: input.reviewedByUserId,
            reviewedAt: input.reviewedAt ?? new Date(),
          },
          include: publicationRequestInclude,
        });
      },

      reject(id: string, input: RejectProblemPublicationRequestInput) {
        return tx.problemPublicationRequest.update({
          where: { id },
          data: {
            status: "rejected",
            reviewNote: input.reviewNote ?? null,
            reviewedByUserId: input.reviewedByUserId,
            reviewedAt: input.reviewedAt ?? new Date(),
          },
          include: publicationRequestInclude,
        });
      },
    };
  },
};
