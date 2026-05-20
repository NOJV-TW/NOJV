import { beforeEach, describe, expect, it, vi } from "vitest";

const { assessmentFindByIdWithCourseId, examFindById, contestFindById } = vi.hoisted(() => ({
  assessmentFindByIdWithCourseId: vi.fn(),
  examFindById: vi.fn(),
  contestFindById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  examRepo: { findById: examFindById },
  contestRepo: { findById: contestFindById },
}));

import { ConflictError, NotFoundError } from "@nojv/domain";
import { isContextClosed, assertContextClosed } from "@nojv/domain";

const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2999-01-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isContextClosed", () => {
  it("assignment: true when now is past closesAt", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", closesAt: PAST });
    expect(await isContextClosed({ type: "assignment", assignmentId: "ca_1" })).toBe(true);
  });

  it("assignment: false when closesAt is in the future", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", closesAt: FUTURE });
    expect(await isContextClosed({ type: "assignment", assignmentId: "ca_1" })).toBe(false);
  });

  it("exam: true when now is past endsAt", async () => {
    examFindById.mockResolvedValue({ id: "e_1", endsAt: PAST });
    expect(await isContextClosed({ type: "exam", examId: "e_1" })).toBe(true);
  });

  it("exam: false when endsAt is in the future", async () => {
    examFindById.mockResolvedValue({ id: "e_1", endsAt: FUTURE });
    expect(await isContextClosed({ type: "exam", examId: "e_1" })).toBe(false);
  });

  it("contest: true when now is past endsAt", async () => {
    contestFindById.mockResolvedValue({ id: "c_1", endsAt: PAST });
    expect(await isContextClosed({ type: "contest", contestId: "c_1" })).toBe(true);
  });

  it("contest: false when endsAt is in the future", async () => {
    contestFindById.mockResolvedValue({ id: "c_1", endsAt: FUTURE });
    expect(await isContextClosed({ type: "contest", contestId: "c_1" })).toBe(false);
  });

  it("throws NotFoundError when the context row is missing", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue(null);
    await expect(
      isContextClosed({ type: "assignment", assignmentId: "ca_missing" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    examFindById.mockResolvedValue(null);
    await expect(isContextClosed({ type: "exam", examId: "e_missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    contestFindById.mockResolvedValue(null);
    await expect(
      isContextClosed({ type: "contest", contestId: "c_missing" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("assertContextClosed", () => {
  it("resolves silently for a closed context", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", closesAt: PAST });
    await expect(
      assertContextClosed({ type: "assignment", assignmentId: "ca_1" }),
    ).resolves.toBeUndefined();
  });

  it("throws ConflictError for an open assignment", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", closesAt: FUTURE });
    await expect(
      assertContextClosed({ type: "assignment", assignmentId: "ca_1" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("throws ConflictError for an open exam", async () => {
    examFindById.mockResolvedValue({ id: "e_1", endsAt: FUTURE });
    await expect(assertContextClosed({ type: "exam", examId: "e_1" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("throws ConflictError for an open contest", async () => {
    contestFindById.mockResolvedValue({ id: "c_1", endsAt: FUTURE });
    await expect(
      assertContextClosed({ type: "contest", contestId: "c_1" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("propagates NotFoundError when the context is missing", async () => {
    contestFindById.mockResolvedValue(null);
    await expect(
      assertContextClosed({ type: "contest", contestId: "c_missing" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
