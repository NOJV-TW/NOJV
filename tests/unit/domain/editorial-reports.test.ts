import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  editorialFindById,
  editorialSoftDelete,
  editorialExistsForUserProblem,
  reportCreate,
  reportFindById,
  reportUpdateStatus,
  reportListByStatus,
  submissionCount,
} = vi.hoisted(() => ({
  editorialFindById: vi.fn(),
  editorialSoftDelete: vi.fn(),
  editorialExistsForUserProblem: vi.fn(),
  reportCreate: vi.fn(),
  reportFindById: vi.fn(),
  reportUpdateStatus: vi.fn(),
  reportListByStatus: vi.fn(),
  submissionCount: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  editorialRepo: {
    findById: editorialFindById,
    softDelete: editorialSoftDelete,
    existsForUserProblem: editorialExistsForUserProblem,
  },
  editorialReportRepo: {
    create: reportCreate,
    findById: reportFindById,
    updateStatus: reportUpdateStatus,
    listByStatus: reportListByStatus,
  },
  submissionRepo: { count: submissionCount },
}));

import { editorialDomain } from "@nojv/application";

const { reportEditorial, listEditorialReports, resolveEditorialReport, canViewEditorials } =
  editorialDomain;

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

function editorialRow(
  overrides: Partial<{
    id: string;
    userId: string;
    problemId: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "ed_1",
    userId: "usr_author",
    problemId: "prob_1",
    content: "body",
    language: "cpp",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  editorialFindById.mockReset();
  editorialSoftDelete.mockReset();
  editorialExistsForUserProblem.mockReset();
  reportCreate.mockReset();
  reportFindById.mockReset();
  reportUpdateStatus.mockReset();
  reportListByStatus.mockReset();
  submissionCount.mockReset();
});

describe("reportEditorial", () => {
  it("rejects reporting your own editorial", async () => {
    editorialFindById.mockResolvedValue(editorialRow({ userId: "usr_author" }));
    await expect(reportEditorial(actor("usr_author"), "ed_1", "spam")).rejects.toMatchObject({
      name: "ValidationError",
      status: 400,
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing editorial", async () => {
    editorialFindById.mockResolvedValue(null);
    await expect(reportEditorial(actor("usr_reporter"), "ed_1", "spam")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted editorial", async () => {
    editorialFindById.mockResolvedValue(editorialRow({ deletedAt: new Date() }));
    await expect(reportEditorial(actor("usr_reporter"), "ed_1", "spam")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects an empty / whitespace-only reason", async () => {
    editorialFindById.mockResolvedValue(editorialRow());
    await expect(reportEditorial(actor("usr_reporter"), "ed_1", "   ")).rejects.toMatchObject({
      name: "ValidationError",
      status: 400,
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("creates a report on the happy path with a trimmed reason", async () => {
    editorialFindById.mockResolvedValue(editorialRow());
    reportCreate.mockResolvedValue({ id: "rep_1" });

    const result = await reportEditorial(actor("usr_reporter"), "ed_1", "  plagiarised  ");

    expect(reportCreate).toHaveBeenCalledWith({
      editorialId: "ed_1",
      reportedByUserId: "usr_reporter",
      reason: "plagiarised",
    });
    expect(result).toEqual({ id: "rep_1" });
  });

  it("maps the unique-constraint violation to ConflictError", async () => {
    editorialFindById.mockResolvedValue(editorialRow());
    const dup = Object.assign(new Error("unique"), { code: "P2002" });
    reportCreate.mockRejectedValue(dup);

    await expect(
      reportEditorial(actor("usr_reporter"), "ed_1", "duplicate"),
    ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
  });
});

describe("listEditorialReports", () => {
  it("is admin-only", async () => {
    await expect(listEditorialReports(actor("usr_student", "student"))).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
  });

  it("returns the rows for an admin", async () => {
    const rows = [{ id: "rep_1" }];
    reportListByStatus.mockResolvedValue(rows);

    await expect(listEditorialReports(actor("usr_admin", "admin"))).resolves.toBe(rows);
    expect(reportListByStatus).toHaveBeenCalledWith("open");
  });
});

describe("resolveEditorialReport", () => {
  it("is admin-only", async () => {
    await expect(
      resolveEditorialReport(actor("usr_student", "student"), "rep_1", "resolve"),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
  });

  it("returns NotFoundError for a missing report", async () => {
    reportFindById.mockResolvedValue(null);
    await expect(
      resolveEditorialReport(actor("usr_admin", "admin"), "rep_1", "resolve"),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
  });

  it("resolve soft-deletes the editorial and marks the report resolved", async () => {
    reportFindById.mockResolvedValue({ id: "rep_1", editorialId: "ed_1" });
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveEditorialReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(editorialSoftDelete).toHaveBeenCalledWith("ed_1");
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "resolved", resolvedByUserId: "usr_admin" }),
    );
  });

  it("dismiss does not soft-delete the editorial", async () => {
    reportFindById.mockResolvedValue({ id: "rep_1", editorialId: "ed_1" });
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "dismissed" });

    await resolveEditorialReport(actor("usr_admin", "admin"), "rep_1", "dismiss");

    expect(editorialSoftDelete).not.toHaveBeenCalled();
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "dismissed", resolvedByUserId: "usr_admin" }),
    );
  });
});

describe("canViewEditorials", () => {
  it("returns true when the user has an accepted submission", async () => {
    submissionCount.mockResolvedValue(1);
    editorialExistsForUserProblem.mockResolvedValue(false);
    await expect(canViewEditorials("usr_1", "prob_1")).resolves.toBe(true);
  });

  it("returns true when the user has authored an editorial (rejudge grandfather)", async () => {
    submissionCount.mockResolvedValue(0);
    editorialExistsForUserProblem.mockResolvedValue(true);
    await expect(canViewEditorials("usr_1", "prob_1")).resolves.toBe(true);
  });

  it("returns false when the user has neither AC nor an authored editorial", async () => {
    submissionCount.mockResolvedValue(0);
    editorialExistsForUserProblem.mockResolvedValue(false);
    await expect(canViewEditorials("usr_1", "prob_1")).resolves.toBe(false);
  });
});
