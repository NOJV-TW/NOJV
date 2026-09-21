import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  problemFindById,
  problemLockForUpdate,
  requestFindById,
  requestFindPending,
  requestCreatePending,
  requestApprove,
  requestReject,
  hasActiveStaff,
  auditCreate,
  forkProblem,
  assertPublishable,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  problemLockForUpdate: vi.fn(),
  requestFindById: vi.fn(),
  requestFindPending: vi.fn(),
  requestCreatePending: vi.fn(),
  requestApprove: vi.fn(),
  requestReject: vi.fn(),
  hasActiveStaff: vi.fn(),
  auditCreate: vi.fn(),
  forkProblem: vi.fn(),
  assertPublishable: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  courseMembershipRepo: {
    hasActiveStaffMembership: hasActiveStaff,
    withTx: () => ({ hasActiveStaffMembership: hasActiveStaff }),
  },
  problemRepo: {
    withTx: () => ({
      findById: problemFindById,
      lockForUpdate: problemLockForUpdate,
    }),
  },
  problemPublicationRequestRepo: {
    withTx: () => ({
      findById: requestFindById,
      findPendingByProblemId: requestFindPending,
      createPending: requestCreatePending,
      approve: requestApprove,
      reject: requestReject,
      lockById: vi.fn(),
    }),
    listPaged: vi.fn(),
  },
  adminAuditLogRepo: { create: auditCreate },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
}));

vi.mock("../../../packages/application/src/problem/fork", () => ({
  forkProblemInTransaction: forkProblem,
}));

vi.mock("../../../packages/application/src/problem/mutations", () => ({
  assertProblemPublishable: assertPublishable,
}));

import {
  approvePublicProblemPublication,
  rejectPublicProblemPublication,
  requestPublicProblemPublication,
} from "../../../packages/application/src/problem/publication-requests";

const ta = { userId: "ta-1", username: "ta", platformRole: "student" as const };
const admin = { userId: "admin-1", username: "admin", platformRole: "admin" as const };
const privateProblem = {
  id: "problem-1",
  authorId: ta.userId,
  visibility: "private" as const,
  status: "published" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  problemFindById.mockResolvedValue(privateProblem);
  problemLockForUpdate.mockResolvedValue(undefined);
  hasActiveStaff.mockResolvedValue(true);
  requestFindPending.mockResolvedValue(null);
  requestCreatePending.mockResolvedValue({ id: "request-1", status: "pending" });
  requestFindById.mockResolvedValue({
    id: "request-1",
    problemId: privateProblem.id,
    requestedByUserId: ta.userId,
    status: "pending",
    problem: privateProblem,
  });
  requestApprove.mockResolvedValue({ id: "request-1", status: "approved" });
  requestReject.mockResolvedValue({ id: "request-1", status: "rejected" });
  forkProblem.mockResolvedValue({ id: "public-1" });
  auditCreate.mockResolvedValue(undefined);
});

describe("requestPublicProblemPublication", () => {
  it("creates one pending request for an owned private problem", async () => {
    await expect(requestPublicProblemPublication(ta, privateProblem.id)).resolves.toEqual({
      id: "request-1",
      status: "pending",
    });

    expect(requestCreatePending).toHaveBeenCalledWith({
      problemId: privateProblem.id,
      requestedByUserId: ta.userId,
    });
  });

  it("rejects a second pending request without changing history", async () => {
    requestFindPending.mockResolvedValue({ id: "existing", status: "pending" });

    await expect(requestPublicProblemPublication(ta, privateProblem.id)).rejects.toThrow(
      /already pending/,
    );
    expect(requestCreatePending).not.toHaveBeenCalled();
  });

  it("rechecks active staff access inside the transaction", async () => {
    hasActiveStaff.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(requestPublicProblemPublication(ta, privateProblem.id)).rejects.toThrow(
      /Only active course staff/,
    );
    expect(requestCreatePending).not.toHaveBeenCalled();
  });
});

describe("admin publication review", () => {
  it("approves a pending request by creating an admin-owned public fork", async () => {
    await expect(approvePublicProblemPublication(admin, "request-1")).resolves.toEqual({
      id: "public-1",
      requestId: "request-1",
    });

    expect(assertPublishable).toHaveBeenCalled();
    expect(forkProblem).toHaveBeenCalledWith(expect.anything(), privateProblem.id, {
      authorId: admin.userId,
      published: true,
      requirePublishedPublicSource: false,
    });
    expect(requestApprove).toHaveBeenCalledWith("request-1", {
      publishedProblemId: "public-1",
      reviewedByUserId: admin.userId,
      reviewedAt: expect.any(Date),
    });
  });

  it("records a rejection note without publishing", async () => {
    await expect(
      rejectPublicProblemPublication(admin, "request-1", "Needs more test coverage."),
    ).resolves.toEqual({ id: "request-1", status: "rejected" });

    expect(requestReject).toHaveBeenCalledWith("request-1", {
      reviewedByUserId: admin.userId,
      reviewNote: "Needs more test coverage.",
      reviewedAt: expect.any(Date),
    });
    expect(forkProblem).not.toHaveBeenCalled();
  });

  it("keeps a request pending when the latest source fails publication validation", async () => {
    assertPublishable.mockRejectedValue(new Error("reference solution required"));

    await expect(approvePublicProblemPublication(admin, "request-1")).rejects.toThrow(
      "reference solution required",
    );
    expect(forkProblem).not.toHaveBeenCalled();
    expect(requestApprove).not.toHaveBeenCalled();
  });

  it("only exposes the request queue to admins", async () => {
    const { listPublicProblemPublicationRequests } =
      await import("../../../packages/application/src/problem/publication-requests");

    await expect(listPublicProblemPublicationRequests(ta, {})).rejects.toThrow(/Admin access/);
  });
});
