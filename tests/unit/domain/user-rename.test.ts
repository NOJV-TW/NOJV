import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted repo stubs so the vi.mock factory can reference them.
const {
  userUpdate,
  userWithTxFindById,
  userWithTxFindByUsername,
  userWithTxUpdate,
  attachPlaceholderInTx,
  courseMembershipFindFirst,
} = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  userWithTxFindById: vi.fn(),
  userWithTxFindByUsername: vi.fn(),
  userWithTxUpdate: vi.fn(),
  attachPlaceholderInTx: vi.fn(),
  courseMembershipFindFirst: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  // The tx passed to callers exposes the Prisma delegates the domain code
  // actually touches — here only `courseMembership.findFirst`.
  const tx = { courseMembership: { findFirst: courseMembershipFindFirst } };
  return {
    userRepo: {
      update: userUpdate,
      withTx: () => ({
        findById: userWithTxFindById,
        findByUsername: userWithTxFindByUsername,
        update: userWithTxUpdate,
      }),
      attachPlaceholderInTx,
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

import { ConflictError, ForbiddenError, ValidationError, userDomain } from "@nojv/domain";

const { renameName, renameUsername } = userDomain;

beforeEach(() => {
  vi.clearAllMocks();
});

// Shape of the User row the mutations read. We only care about `id`,
// `username`, and `status` — other fields are irrelevant to the logic.
function fakeUser(overrides: { id?: string; username?: string | null; status?: string } = {}) {
  return {
    id: overrides.id ?? "usr_actor",
    username: overrides.username === undefined ? "oldname" : overrides.username,
    status: overrides.status ?? "active",
  };
}

describe("renameName", () => {
  it("trims whitespace and persists the trimmed value", async () => {
    await renameName("usr_actor", "  Alice Liddell  ");
    expect(userUpdate).toHaveBeenCalledWith("usr_actor", { name: "Alice Liddell" });
  });

  it("rejects an empty or whitespace-only name", async () => {
    await expect(renameName("usr_actor", "")).rejects.toBeInstanceOf(ValidationError);
    await expect(renameName("usr_actor", "   ")).rejects.toBeInstanceOf(ValidationError);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("accepts a 64-character name (inclusive upper bound) and rejects 65", async () => {
    const sixtyFour = "x".repeat(64);
    const sixtyFive = "x".repeat(65);

    await renameName("usr_actor", sixtyFour);
    expect(userUpdate).toHaveBeenCalledWith("usr_actor", { name: sixtyFour });

    await expect(renameName("usr_actor", sixtyFive)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("renameUsername", () => {
  it("happy path — non-verified user takes an unused name, merged: false", async () => {
    userWithTxFindById.mockResolvedValueOnce(fakeUser({ username: "oldname" }));
    userWithTxFindByUsername.mockResolvedValueOnce(null);

    const result = await renameUsername("usr_actor", "newname");

    expect(result).toEqual({ merged: false });
    expect(userWithTxUpdate).toHaveBeenCalledWith("usr_actor", {
      username: "newname",
      displayUsername: "newname",
    });
    expect(attachPlaceholderInTx).not.toHaveBeenCalled();
  });

  it("verified user (student-ID username) throws VERIFIED_LOCKED", async () => {
    userWithTxFindById.mockResolvedValueOnce(fakeUser({ username: "41047001a" }));

    const err = await renameUsername("usr_actor", "newname").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("VERIFIED_LOCKED");
    expect(userWithTxUpdate).not.toHaveBeenCalled();
  });

  it("placeholder user throws PLACEHOLDER_LOCKED", async () => {
    userWithTxFindById.mockResolvedValueOnce(
      fakeUser({ username: "somehandle", status: "pending_first_login" }),
    );

    const err = await renameUsername("usr_actor", "newname").catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("PLACEHOLDER_LOCKED");
    expect(userWithTxUpdate).not.toHaveBeenCalled();
  });

  it("new === current is a no-op that returns merged: false", async () => {
    userWithTxFindById.mockResolvedValueOnce(fakeUser({ username: "samename" }));

    const result = await renameUsername("usr_actor", "samename");

    expect(result).toEqual({ merged: false });
    expect(userWithTxFindByUsername).not.toHaveBeenCalled();
    expect(userWithTxUpdate).not.toHaveBeenCalled();
  });

  it("new username matching student-ID format throws RESERVED_FORMAT", async () => {
    userWithTxFindById.mockResolvedValueOnce(fakeUser({ username: "oldname" }));

    const err = await renameUsername("usr_actor", "41047001a").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("RESERVED_FORMAT");
    expect(userWithTxFindByUsername).not.toHaveBeenCalled();
    expect(userWithTxUpdate).not.toHaveBeenCalled();
  });

  it("format violations (uppercase, whitespace, special chars) throw INVALID_FORMAT", async () => {
    // Uppercase input is normalized to lowercase first and therefore accepted —
    // only chars that remain invalid after .toLowerCase() should throw.
    const rejections = ["has space", "bang!name", "", "a".repeat(65)];
    for (const bad of rejections) {
      userWithTxFindById.mockResolvedValueOnce(fakeUser({ username: "oldname" }));
      const err = await renameUsername("usr_actor", bad).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toBe("INVALID_FORMAT");
    }
    expect(userWithTxUpdate).not.toHaveBeenCalled();
  });

  it("new username taken by an active user throws TAKEN", async () => {
    userWithTxFindById.mockResolvedValueOnce(fakeUser({ username: "oldname" }));
    userWithTxFindByUsername.mockResolvedValueOnce({
      id: "usr_other",
      username: "newname",
      status: "active",
    });

    const err = await renameUsername("usr_actor", "newname").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("TAKEN");
    expect(attachPlaceholderInTx).not.toHaveBeenCalled();
    expect(userWithTxUpdate).not.toHaveBeenCalled();
  });

  it("new username matches a student-only placeholder — merges memberships, deletes placeholder, merged: true", async () => {
    userWithTxFindById.mockResolvedValueOnce(
      fakeUser({ id: "usr_actor", username: "oldname" }),
    );
    userWithTxFindByUsername.mockResolvedValueOnce({
      id: "usr_placeholder",
      username: "newname",
      status: "pending_first_login",
    });
    courseMembershipFindFirst.mockResolvedValueOnce(null);

    const result = await renameUsername("usr_actor", "newname");

    expect(result).toEqual({ merged: true });
    expect(courseMembershipFindFirst).toHaveBeenCalledWith({
      where: { userId: "usr_placeholder", role: { in: ["teacher", "ta"] } },
      select: { id: true },
    });
    expect(attachPlaceholderInTx).toHaveBeenCalledWith(
      expect.anything(),
      "usr_placeholder",
      "usr_actor",
    );
    expect(userWithTxUpdate).toHaveBeenCalledWith("usr_actor", {
      username: "newname",
      displayUsername: "newname",
    });
  });

  // Regression: without this guard, any enrolled student could rename to a
  // pre-invited TA/teacher handle and inherit the CourseMembership.role ==
  // "ta"/"teacher", escalating to course-manager privileges. We surface the
  // generic TAKEN error so privileged placeholders cannot be fingerprinted.
  it("placeholder with a TA course membership — refuses to merge and throws TAKEN", async () => {
    userWithTxFindById.mockResolvedValueOnce(fakeUser({ username: "oldname" }));
    userWithTxFindByUsername.mockResolvedValueOnce({
      id: "usr_placeholder",
      username: "alice_ta2026",
      status: "pending_first_login",
    });
    courseMembershipFindFirst.mockResolvedValueOnce({ id: "cm_elevated" });

    const err = await renameUsername("usr_actor", "alice_ta2026").catch((e) => e);

    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("TAKEN");
    expect(attachPlaceholderInTx).not.toHaveBeenCalled();
    expect(userWithTxUpdate).not.toHaveBeenCalled();
  });

  it("placeholder with a teacher course membership — refuses to merge and throws TAKEN", async () => {
    userWithTxFindById.mockResolvedValueOnce(fakeUser({ username: "oldname" }));
    userWithTxFindByUsername.mockResolvedValueOnce({
      id: "usr_placeholder",
      username: "prof_x",
      status: "pending_first_login",
    });
    courseMembershipFindFirst.mockResolvedValueOnce({ id: "cm_elevated" });

    const err = await renameUsername("usr_actor", "prof_x").catch((e) => e);

    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("TAKEN");
    expect(attachPlaceholderInTx).not.toHaveBeenCalled();
    expect(userWithTxUpdate).not.toHaveBeenCalled();
  });
});
