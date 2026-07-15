import { beforeEach, describe, expect, it, vi } from "vitest";

const { findById, update, findDisabledStatus, createNotification } = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn((id: string, data: object) =>
    Promise.resolve({ id, ...data, updatedAt: new Date("2026-01-01T00:00:00.000Z") }),
  ),
  findDisabledStatus: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  userRepo: {
    findById,
    update,
    findDisabledStatus,
    withTx: () => ({ findById, update }),
  },
  submissionRepo: {},
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
}));

vi.mock("../../../packages/application/src/notification", () => ({
  createNotificationInTransaction: createNotification,
}));

import { userDomain } from "@nojv/application";

const { updateUserRole, toggleUserDisabled } = userDomain;

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(update).toHaveBeenCalledWith("u1", { platformRole: "admin" });
  });

  it("demotes an admin and clears isSuperAdmin in one database update", async () => {
    findById.mockResolvedValue({ id: "u1", platformRole: "admin" });
    await updateUserRole(true, "u1", "teacher");
    expect(update).toHaveBeenCalledWith("u1", { platformRole: "teacher", isSuperAdmin: false });
    expect(update).toHaveBeenCalledOnce();
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
