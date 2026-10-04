import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findActiveSession: vi.fn(),
  findAssessment: vi.fn(),
  findMembership: vi.fn(),
  findCourse: vi.fn(),
  problemLinked: vi.fn(),
  listDrafts: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("@nojv/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nojv/db")>()),
  examSessionRepo: { findActiveForUser: mocks.findActiveSession },
  assessmentRepo: { findByIdWithCourseId: mocks.findAssessment },
  courseMembershipRepo: { findByComposite: mocks.findMembership },
  courseRepo: { findById: mocks.findCourse },
  assessmentProblemRepo: { exists: mocks.problemLinked },
  codeDraftRepo: { listForProblem: mocks.listDrafts, save: mocks.saveDraft },
}));

import { ForbiddenError } from "../../../packages/application/src/shared/errors";
import { listCodeDrafts, saveCodeDraft } from "../../../packages/application/src/code-draft";

const actor = {
  userId: "usr_student",
  username: "student",
  platformRole: "student" as const,
  displayName: "Student",
  email: "student@example.com",
};
const scope = {
  context: { type: "assignment" as const, courseId: "crs_1", assessmentId: "asm_1" },
  problemId: "prob_1",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findActiveSession.mockResolvedValue(null);
  mocks.findAssessment.mockResolvedValue({
    id: "asm_1",
    courseId: "crs_1",
    status: "published",
    opensAt: new Date("2020-01-01T00:00:00Z"),
    closesAt: new Date("2999-01-01T00:00:00Z"),
  });
  mocks.findMembership.mockResolvedValue({ role: "student", status: "active" });
  mocks.findCourse.mockResolvedValue({ id: "crs_1", archived: false });
  mocks.problemLinked.mockResolvedValue(true);
  mocks.listDrafts.mockResolvedValue([]);
  mocks.saveDraft.mockResolvedValue({ updatedAt: new Date("2026-01-01T00:00:00Z") });
});

describe("assignment code drafts", () => {
  it("reads and saves drafts while the course is active", async () => {
    await expect(listCodeDrafts(actor, scope, "127.0.0.1")).resolves.toEqual([]);
    await expect(
      saveCodeDraft(actor, { ...scope, language: "python", sourceCode: "x" }, "127.0.0.1"),
    ).resolves.toEqual({ updatedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("rejects reads and writes once the course is archived", async () => {
    mocks.findCourse.mockResolvedValue({ id: "crs_1", archived: true });

    await expect(listCodeDrafts(actor, scope, "127.0.0.1")).rejects.toThrow(
      new ForbiddenError("This course is archived."),
    );
    await expect(
      saveCodeDraft(actor, { ...scope, language: "python", sourceCode: "x" }, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.listDrafts).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
});
