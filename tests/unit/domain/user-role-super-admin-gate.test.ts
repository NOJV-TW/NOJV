import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findById,
  update,
  findDisabledStatus,
  listSessionIds,
  deleteRedisKeys,
  incrementEpoch,
  createAndCap,
  publishNotification,
} = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn((id: string, data: object) => Promise.resolve({ id, ...data })),
  findDisabledStatus: vi.fn(),
  listSessionIds: vi.fn(),
  deleteRedisKeys: vi.fn(),
  incrementEpoch: vi.fn(),
  createAndCap: vi.fn(() =>
    Promise.resolve({
      id: "ntf_1",
      userId: "u1",
      type: "role_changed",
      params: {},
      linkUrl: "/account",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      read: false,
    }),
  ),
  publishNotification: vi.fn(() => Promise.resolve()),
}));

vi.mock("@nojv/db", () => ({
  userRepo: { findById, update, findDisabledStatus, listSessionIds },
  submissionRepo: {},
  notificationRepo: { createAndCap },
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({ del: deleteRedisKeys, incr: incrementEpoch }),
  keys: {
    adminElevationEpoch: (userId: string) => `nojv:admin:epoch:${userId}`,
    adminSessionMfa: (sessionId: string) => `nojv:admin:mfa:${sessionId}`,
    adminMode: (sessionId: string) => `nojv:admin:mode:${sessionId}`,
  },
  pubsub: { publishNotification },
}));

import { userDomain } from "@nojv/application";

const { updateUserRole, toggleUserDisabled } = userDomain;

beforeEach(() => {
  vi.clearAllMocks();
  listSessionIds.mockResolvedValue([]);
  deleteRedisKeys.mockResolvedValue(0);
  incrementEpoch.mockResolvedValue(1);
});

describe("updateUserRole — super-admin gate", () => {
  it("a regular admin cannot grant admin", async () => {
    findById.mockResolvedValue({ id: "u1", platformRole: "student" });
    await expect(updateUserRole(false, "u1", "admin")).rejects.toMatchObject({
      name: "ForbiddenError",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("a regular admin cannot demote an existing admin", async () => {
    findById.mockResolvedValue({ id: "u1", platformRole: "admin" });
    await expect(updateUserRole(false, "u1", "teacher")).rejects.toMatchObject({
      name: "ForbiddenError",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("a super admin can grant admin", async () => {
    findById.mockResolvedValue({ id: "u1", platformRole: "student" });
    await updateUserRole(true, "u1", "admin");
    expect(incrementEpoch).toHaveBeenCalledWith("nojv:admin:epoch:u1");
    expect(update).toHaveBeenCalledWith("u1", { platformRole: "admin" });
    expect(incrementEpoch.mock.invocationCallOrder[0]!).toBeLessThan(
      update.mock.invocationCallOrder[0]!,
    );
  });

  it("demoting an admin clears isSuperAdmin", async () => {
    findById.mockResolvedValue({ id: "u1", platformRole: "admin" });
    listSessionIds.mockResolvedValue(["sess_1", "sess_2"]);
    await updateUserRole(true, "u1", "teacher");
    expect(incrementEpoch).toHaveBeenCalledWith("nojv:admin:epoch:u1");
    expect(deleteRedisKeys).toHaveBeenCalledWith(
      "nojv:admin:mfa:sess_1",
      "nojv:admin:mode:sess_1",
      "nojv:admin:mfa:sess_2",
      "nojv:admin:mode:sess_2",
    );
    expect(update).toHaveBeenCalledWith("u1", { platformRole: "teacher", isSuperAdmin: false });
    expect(update.mock.invocationCallOrder[0]!).toBeLessThan(
      incrementEpoch.mock.invocationCallOrder[0]!,
    );
    expect(incrementEpoch.mock.invocationCallOrder[0]!).toBeLessThan(
      listSessionIds.mock.invocationCallOrder[0]!,
    );
  });

  it("a regular admin may still move a non-admin between teacher and student", async () => {
    findById.mockResolvedValue({ id: "u1", platformRole: "student" });
    await updateUserRole(false, "u1", "teacher");
    expect(update).toHaveBeenCalledWith("u1", { platformRole: "teacher", isSuperAdmin: false });
  });
});

describe("toggleUserDisabled — super-admin protection", () => {
  it("a regular admin cannot disable a super admin", async () => {
    findDisabledStatus.mockResolvedValue({ disabled: false, isSuperAdmin: true });
    await expect(toggleUserDisabled(false, "u1")).rejects.toMatchObject({
      name: "ForbiddenError",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("a super admin can disable a super admin", async () => {
    findDisabledStatus.mockResolvedValue({ disabled: false, isSuperAdmin: true });
    await toggleUserDisabled(true, "u1");
    expect(update).toHaveBeenCalledWith("u1", { disabled: true });
  });

  it("a regular admin may disable a non-super user", async () => {
    findDisabledStatus.mockResolvedValue({ disabled: false, isSuperAdmin: false });
    await toggleUserDisabled(false, "u1");
    expect(update).toHaveBeenCalledWith("u1", { disabled: true });
  });

  it("returns null for an unknown user", async () => {
    findDisabledStatus.mockResolvedValue(null);
    expect(await toggleUserDisabled(true, "u1")).toBeNull();
  });
});
