import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../packages/db/src/client", () => ({ prisma: {} }));

import { participationRepo } from "../../../packages/db/src/repositories/participation";

const updateMany = vi.fn();
const tx = { participation: { updateMany } } as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("participationRepo.bindExamIpPinIfUnset", () => {
  it("pins only a participation that has no pin yet", async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await expect(
      participationRepo.withTx(tx).bindExamIpPinIfUnset("part_1", "203.0.113.7"),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "part_1", ipPin: null },
      data: { ipPin: "203.0.113.7" },
    });
  });

  it("reports a lost race when another request already pinned", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      participationRepo.withTx(tx).bindExamIpPinIfUnset("part_1", "198.51.100.20"),
    ).resolves.toBe(false);
  });
});
