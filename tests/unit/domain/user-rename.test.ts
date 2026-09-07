import { beforeEach, describe, expect, it, vi } from "vitest";

const { userUpdate, runTransaction } = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  userRepo: { update: userUpdate },
  runTransaction,
}));

import { ConflictError, ValidationError, userDomain } from "@nojv/application";

beforeEach(() => vi.clearAllMocks());

describe("renameName validation", () => {
  it("trims the display name before persisting it", async () => {
    await userDomain.renameName("user-1", "  Alice Liddell  ");
    expect(userUpdate).toHaveBeenCalledWith("user-1", { name: "Alice Liddell" });
  });

  it.each(["", "   ", "x".repeat(65)])(
    "rejects invalid name %j without writing",
    async (name) => {
      await expect(userDomain.renameName("user-1", name)).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(userUpdate).not.toHaveBeenCalled();
    },
  );

  it("accepts the inclusive 64-character limit", async () => {
    await userDomain.renameName("user-1", "x".repeat(64));
    expect(userUpdate).toHaveBeenCalledWith("user-1", { name: "x".repeat(64) });
  });
});

describe("renameUsername validation before identity writes", () => {
  it.each(["", "  ", "ab", "has space", "bang!name", "x".repeat(65)])(
    "rejects invalid username %j",
    async (username) => {
      await expect(userDomain.renameUsername("user-1", username)).rejects.toMatchObject({
        message: "INVALID_FORMAT",
      });
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    "41047001a",
    "ntu_b11902001",
    "ntust_b11902001",
    "b11902001",
    "ntnu_41047001a",
    "ntu_41047001a",
    "ntust_41047001a",
    " NTU_B11902001 ",
  ])("requires school verification for reserved username %j", async (username) => {
    await expect(userDomain.renameUsername("user-1", username)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(userDomain.renameUsername("user-1", username)).rejects.toThrow(
      "RESERVED_FORMAT",
    );
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
