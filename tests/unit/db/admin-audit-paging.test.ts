import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("../../../packages/db/src/client", () => ({
  prisma: { adminAuditLog: { findMany: mock.findMany } },
}));
import { adminAuditLogRepo } from "../../../packages/db/src/repositories/admin-audit";

beforeEach(() => {
  vi.resetAllMocks();
  mock.findMany.mockResolvedValue([]);
});

describe("admin audit log paging", () => {
  it("orders newest first by default", async () => {
    await adminAuditLogRepo.listPaged({ limit: 50 });
    expect(mock.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
    });
  });

  it("orders oldest first when asked and keeps the cursor shape", async () => {
    await adminAuditLogRepo.listPaged({ limit: 50, order: "asc", cursor: "a1" });
    expect(mock.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 51,
      cursor: { id: "a1" },
      skip: 1,
    });
  });
});
