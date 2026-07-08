import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPaginated, count, findDisabledStatus, update, createAndCap, publishNotification } =
  vi.hoisted(() => ({
    listPaginated: vi.fn(() => Promise.resolve([])),
    count: vi.fn(() => Promise.resolve(0)),
    findDisabledStatus: vi.fn(),
    update: vi.fn((id: string, data: object) => Promise.resolve({ id, ...data })),
    createAndCap: vi.fn(() => Promise.resolve({})),
    publishNotification: vi.fn(() => Promise.resolve()),
  }));

vi.mock("@nojv/db", () => ({
  userRepo: { listPaginated, count, findDisabledStatus, update },
  submissionRepo: {},
  notificationRepo: { createAndCap },
}));

vi.mock("@nojv/redis", () => ({
  pubsub: { publishNotification },
}));

import { userDomain } from "@nojv/application";

const { listUsersPaginated, setUserDisabled } = userDomain;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listUsersPaginated — statusFilter", () => {
  it("maps statusFilter 'disabled' to where.disabled = true", async () => {
    await listUsersPaginated({ statusFilter: "disabled" });
    expect(listPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ where: { disabled: true } }),
    );
    expect(count).toHaveBeenCalledWith({ disabled: true });
  });

  it("maps statusFilter 'active' to where.disabled = false", async () => {
    await listUsersPaginated({ statusFilter: "active" });
    expect(listPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ where: { disabled: false } }),
    );
    expect(count).toHaveBeenCalledWith({ disabled: false });
  });

  it("omits the disabled predicate when no statusFilter is given", async () => {
    await listUsersPaginated({});
    expect(listPaginated).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(count).toHaveBeenCalledWith({});
  });

  it("combines statusFilter with roleFilter", async () => {
    await listUsersPaginated({ statusFilter: "active", roleFilter: "teacher" });
    expect(listPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ where: { platformRole: "teacher", disabled: false } }),
    );
  });
});

describe("setUserDisabled — explicit idempotent set", () => {
  it("sets disabled = true regardless of current value", async () => {
    findDisabledStatus.mockResolvedValue({ disabled: true, isSuperAdmin: false });
    await setUserDisabled(false, "u1", true);
    expect(update).toHaveBeenCalledWith("u1", { disabled: true });
  });

  it("sets disabled = false regardless of current value", async () => {
    findDisabledStatus.mockResolvedValue({ disabled: false, isSuperAdmin: false });
    await setUserDisabled(false, "u1", false);
    expect(update).toHaveBeenCalledWith("u1", { disabled: false });
  });

  it("a regular admin cannot disable a super admin", async () => {
    findDisabledStatus.mockResolvedValue({ disabled: false, isSuperAdmin: true });
    await expect(setUserDisabled(false, "u1", true)).rejects.toMatchObject({
      name: "ForbiddenError",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("a super admin can disable a super admin", async () => {
    findDisabledStatus.mockResolvedValue({ disabled: false, isSuperAdmin: true });
    await setUserDisabled(true, "u1", true);
    expect(update).toHaveBeenCalledWith("u1", { disabled: true });
  });

  it("returns null for an unknown user", async () => {
    findDisabledStatus.mockResolvedValue(null);
    expect(await setUserDisabled(true, "u1", true)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
