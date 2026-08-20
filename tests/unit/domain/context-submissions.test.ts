import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listRecentForContext,
  assessmentFindById,
  examFindById,
  courseFindByIdWithUserMembership,
} = vi.hoisted(() => ({
  listRecentForContext: vi.fn(),
  assessmentFindById: vi.fn(),
  examFindById: vi.fn(),
  courseFindByIdWithUserMembership: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { listRecentForContext },
  assessmentRepo: { findByIdWithCourseId: assessmentFindById },
  examRepo: { findById: examFindById },
  courseRepo: { findByIdWithUserMembership: courseFindByIdWithUserMembership },
}));

import { ForbiddenError, submissionDomain, type ActorContext } from "@nojv/application";

const actor: ActorContext = {
  userId: "teacher_1",
  email: "teacher@example.com",
  username: "teacher",
  displayName: "Teacher",
  platformRole: "teacher",
};

describe("listRecentContextSubmissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecentForContext.mockResolvedValue([]);
    assessmentFindById.mockResolvedValue({ courseId: "course_1" });
    examFindById.mockResolvedValue({ courseId: "course_1" });
    courseFindByIdWithUserMembership.mockResolvedValue({
      id: "course_1",
      ownerId: "owner_1",
      memberships: [{ role: "teacher", status: "active" }],
    });
  });

  it("is exposed as the context-scoped live submission query", () => {
    expect(submissionDomain.listRecentContextSubmissions).toBeTypeOf("function");
  });

  it.each([
    ["assignment", "assignment_1"],
    ["exam", "exam_1"],
  ] as const)("scopes recent rows to the %s context", async (type, id) => {
    await submissionDomain.listRecentContextSubmissions({
      actor,
      context: { type, id },
      limit: 500,
    });

    expect(listRecentForContext).toHaveBeenCalledWith({
      context: { type, id },
      limit: 100,
    });
  });

  it("serializes timestamps for the live feed boundary", async () => {
    listRecentForContext.mockResolvedValue([
      {
        id: "sub_1",
        ipAddress: "203.0.113.42",
        createdAt: new Date("2026-08-19T12:34:56.000Z"),
        language: "cpp17",
        score: 80,
        status: "accepted",
        problem: { id: "p1", title: "A + B" },
        user: { id: "u1", name: "Alice", username: "alice" },
      },
    ]);

    const rows = await submissionDomain.listRecentContextSubmissions({
      actor,
      context: { type: "assignment", id: "assignment_1" },
    });

    expect(rows[0]).toMatchObject({
      id: "sub_1",
      ipAddress: "203.0.113.42",
      createdAt: "2026-08-19T12:34:56.000Z",
      language: "cpp17",
      score: 80,
      status: "accepted",
      problem: { id: "p1", title: "A + B" },
      user: { id: "u1", name: "Alice", username: "alice" },
    });
  });

  it("rejects non-staff viewers", async () => {
    courseFindByIdWithUserMembership.mockResolvedValue({
      id: "course_1",
      ownerId: "owner_1",
      memberships: [{ role: "student", status: "active" }],
    });

    await expect(
      submissionDomain.listRecentContextSubmissions({
        actor: { ...actor, userId: "student_1", platformRole: "student" },
        context: { type: "assignment", id: "assignment_1" },
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(listRecentForContext).not.toHaveBeenCalled();
  });
});
