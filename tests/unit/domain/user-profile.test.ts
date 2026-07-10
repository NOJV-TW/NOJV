import { beforeEach, describe, expect, it, vi } from "vitest";

const { findById, update, findDistinctPublicAcByUser, findMany, groupByLanguageForUser } =
  vi.hoisted(() => ({
    findById: vi.fn(),
    update: vi.fn(),
    findDistinctPublicAcByUser: vi.fn(() => Promise.resolve([])),
    findMany: vi.fn(() => Promise.resolve([])),
    groupByLanguageForUser: vi.fn(() => Promise.resolve([])),
  }));

vi.mock("@nojv/db", () => ({
  userRepo: { findById, update },
  submissionRepo: { findDistinctPublicAcByUser, findMany, groupByLanguageForUser },
}));

import { userDomain, NotFoundError } from "@nojv/application";

const { canViewProfile, getPublicProfile, updateProfileVisibility } = userDomain;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canViewProfile", () => {
  const publicTarget = { id: "u1", profilePublic: true };
  const privateTarget = { id: "u1", profilePublic: false };

  it("allows anyone, including logged-out viewers, on public profiles", () => {
    expect(canViewProfile(null, publicTarget)).toBe(true);
    expect(canViewProfile({ userId: "u2", isAdmin: false }, publicTarget)).toBe(true);
  });

  it("denies logged-out and other users on private profiles", () => {
    expect(canViewProfile(null, privateTarget)).toBe(false);
    expect(canViewProfile({ userId: "u2", isAdmin: false }, privateTarget)).toBe(false);
  });

  it("allows the owner and admins on private profiles", () => {
    expect(canViewProfile({ userId: "u1", isAdmin: false }, privateTarget)).toBe(true);
    expect(canViewProfile({ userId: "u2", isAdmin: true }, privateTarget)).toBe(true);
  });
});

describe("getPublicProfile", () => {
  it("throws NotFoundError when the user does not exist", async () => {
    findById.mockResolvedValue(null);
    await expect(getPublicProfile("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns basics, public solved problems, and distributions", async () => {
    findById.mockResolvedValue({
      id: "u1",
      name: "Alice",
      username: "alice",
      image: null,
      profilePublic: true,
      createdAt: new Date("2026-01-01"),
    });
    findDistinctPublicAcByUser.mockResolvedValue([
      {
        problemId: "p1",
        problem: { id: "p1", displayId: 1, title: "A", difficulty: "easy", tags: ["dp"] },
      },
      {
        problemId: "p2",
        problem: { id: "p2", displayId: 2, title: "B", difficulty: "easy", tags: ["dp", "graph"] },
      },
    ]);
    groupByLanguageForUser.mockResolvedValue([
      { language: "cpp", _count: { _all: 5 } },
      { language: "python", _count: { _all: 2 } },
    ]);
    findMany.mockResolvedValue([
      { createdAt: new Date("2026-06-01T10:00:00Z"), status: "accepted" },
      { createdAt: new Date("2026-06-02T10:00:00Z"), status: "wrong_answer" },
    ]);

    const profile = await getPublicProfile("u1", new Date("2026-07-01"));

    expect(profile.user).toMatchObject({ id: "u1", name: "Alice", profilePublic: true });
    expect(profile.solvedProblems).toHaveLength(2);
    expect(profile.byDifficulty).toEqual([{ difficulty: "easy", acCount: 2 }]);
    expect(profile.byLanguage).toEqual([
      { language: "cpp", count: 5 },
      { language: "python", count: 2 },
    ]);
    expect(profile.activity).toEqual([
      { createdAt: new Date("2026-06-01T10:00:00Z"), isAc: true },
      { createdAt: new Date("2026-06-02T10:00:00Z"), isAc: false },
    ]);
  });

  it("only queries AC submissions on public published problems", async () => {
    findById.mockResolvedValue({
      id: "u1",
      name: "Alice",
      username: null,
      image: null,
      profilePublic: true,
      createdAt: new Date("2026-01-01"),
    });

    await getPublicProfile("u1", new Date("2026-07-01"));

    expect(findDistinctPublicAcByUser).toHaveBeenCalledWith("u1");
  });
});

describe("updateProfileVisibility", () => {
  it("persists the flag through the user repo", async () => {
    update.mockResolvedValue({});
    await updateProfileVisibility("u1", true);
    expect(update).toHaveBeenCalledWith("u1", { profilePublic: true });
  });
});
