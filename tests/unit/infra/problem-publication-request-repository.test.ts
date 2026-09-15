import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    problemPublicationRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../../packages/db/src/client", () => ({ prisma: prismaMock }));

import { problemPublicationRequestRepo } from "../../../packages/db/src/repositories/problem-publication-request";

describe("problemPublicationRequestRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a pending request with the requester and source problem", async () => {
    const row = { id: "request-1", status: "pending" };
    prismaMock.problemPublicationRequest.create.mockResolvedValue(row);

    await expect(
      problemPublicationRequestRepo.createPending({
        problemId: "problem-1",
        requestedByUserId: "user-1",
      }),
    ).resolves.toBe(row);

    expect(prismaMock.problemPublicationRequest.create).toHaveBeenCalledWith({
      data: {
        problemId: "problem-1",
        requestedByUserId: "user-1",
        status: "pending",
      },
    });
  });

  it("lists requests by status with a stable cursor page", async () => {
    prismaMock.problemPublicationRequest.findMany.mockResolvedValue([]);

    await problemPublicationRequestRepo.listPaged({
      status: "pending",
      limit: 25,
      cursor: "request-previous",
    });

    expect(prismaMock.problemPublicationRequest.findMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 26,
      cursor: { id: "request-previous" },
      skip: 1,
      include: expect.any(Object),
    });
  });

  it("locks a request for review inside a transaction", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      problemPublicationRequest: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    await problemPublicationRequestRepo.withTx(tx as never).lockById("request-1");

    expect(tx.$queryRaw).toHaveBeenCalled();
  });
});
