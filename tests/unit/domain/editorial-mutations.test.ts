import { beforeEach, describe, expect, it, vi } from "vitest";

const { editorialFindById, editorialUpdate, editorialSoftDelete } = vi.hoisted(() => ({
  editorialFindById: vi.fn(),
  editorialUpdate: vi.fn(),
  editorialSoftDelete: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  editorialRepo: {
    findById: editorialFindById,
    update: editorialUpdate,
    softDelete: editorialSoftDelete,
  },
  submissionRepo: { count: vi.fn() },
}));

import { problemDomain } from "@nojv/domain";

const { updateEditorial, softDeleteEditorial, getEditorialById } = problemDomain;

interface FakeActor {
  displayName: string;
  email: string;
  username: string;
  platformRole: "admin" | "teacher" | "student";
  userId: string;
}

function actor(userId: string, platformRole: FakeActor["platformRole"] = "student"): FakeActor {
  return {
    displayName: userId,
    email: `${userId}@example.test`,
    username: userId,
    platformRole,
    userId,
  };
}

function row(
  overrides: Partial<{
    id: string;
    userId: string;
    problemId: string;
    content: string;
    language: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "ed_1",
    userId: "usr_author",
    problemId: "prob_1",
    content: "old body",
    language: "cpp",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    user: { username: "author", name: "Author" },
    ...overrides,
  };
}

beforeEach(() => {
  editorialFindById.mockReset();
  editorialUpdate.mockReset();
  editorialSoftDelete.mockReset();
});

describe("getEditorialById", () => {
  it("returns the row when present and not soft-deleted", async () => {
    const live = row();
    editorialFindById.mockResolvedValue(live);
    await expect(getEditorialById("ed_1")).resolves.toBe(live);
  });

  it("returns null for missing rows", async () => {
    editorialFindById.mockResolvedValue(null);
    await expect(getEditorialById("ed_1")).resolves.toBeNull();
  });

  it("returns null for soft-deleted rows", async () => {
    editorialFindById.mockResolvedValue(row({ deletedAt: new Date() }));
    await expect(getEditorialById("ed_1")).resolves.toBeNull();
  });
});

describe("updateEditorial", () => {
  it("allows the author to edit their own editorial", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author" }));
    editorialUpdate.mockResolvedValue(row({ content: "new body" }));

    const result = await updateEditorial(actor("usr_author"), "ed_1", { content: "new body" });

    expect(editorialUpdate).toHaveBeenCalledWith("ed_1", { content: "new body" });
    expect(result).toMatchObject({ content: "new body" });
  });

  it("allows an admin to edit another user's editorial", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_someone_else" }));
    editorialUpdate.mockResolvedValue(row({ content: "moderated" }));

    await updateEditorial(actor("usr_admin", "admin"), "ed_1", { content: "moderated" });

    expect(editorialUpdate).toHaveBeenCalledWith("ed_1", { content: "moderated" });
  });

  it("forbids non-author non-admin users", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author" }));
    await expect(
      updateEditorial(actor("usr_intruder"), "ed_1", { content: "vandalism vandalism" }),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(editorialUpdate).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for missing editorials", async () => {
    editorialFindById.mockResolvedValue(null);
    await expect(
      updateEditorial(actor("usr_author"), "ed_1", { content: "new body" }),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(editorialUpdate).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for soft-deleted editorials (hides existence)", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author", deletedAt: new Date() }));
    await expect(
      updateEditorial(actor("usr_author"), "ed_1", { content: "new body" }),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(editorialUpdate).not.toHaveBeenCalled();
  });

  it("skips the write when nothing actually changed", async () => {
    const existing = row({ userId: "usr_author", content: "same body", language: "cpp" });
    editorialFindById.mockResolvedValue(existing);

    const result = await updateEditorial(actor("usr_author"), "ed_1", {
      content: "same body",
      language: "cpp",
    });

    expect(editorialUpdate).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it("only forwards fields that actually changed", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author", language: "cpp" }));
    editorialUpdate.mockResolvedValue(row());

    await updateEditorial(actor("usr_author"), "ed_1", {
      content: "old body", // unchanged
      language: "python", // changed
    });

    expect(editorialUpdate).toHaveBeenCalledWith("ed_1", { language: "python" });
  });
});

describe("softDeleteEditorial", () => {
  it("allows the author to delete their own editorial", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author" }));
    editorialSoftDelete.mockResolvedValue(row({ deletedAt: new Date() }));

    await softDeleteEditorial(actor("usr_author"), "ed_1");

    expect(editorialSoftDelete).toHaveBeenCalledWith("ed_1");
  });

  it("allows an admin to delete another user's editorial", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_someone_else" }));
    editorialSoftDelete.mockResolvedValue(row({ deletedAt: new Date() }));

    await softDeleteEditorial(actor("usr_admin", "admin"), "ed_1");

    expect(editorialSoftDelete).toHaveBeenCalledWith("ed_1");
  });

  it("forbids non-author non-admin users", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author" }));
    await expect(softDeleteEditorial(actor("usr_intruder"), "ed_1")).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(editorialSoftDelete).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for missing editorials", async () => {
    editorialFindById.mockResolvedValue(null);
    await expect(softDeleteEditorial(actor("usr_author"), "ed_1")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(editorialSoftDelete).not.toHaveBeenCalled();
  });

  it("treats double-delete as 404 (idempotent NotFoundError on the second call)", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author", deletedAt: new Date() }));
    await expect(softDeleteEditorial(actor("usr_author"), "ed_1")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(editorialSoftDelete).not.toHaveBeenCalled();
  });
});
