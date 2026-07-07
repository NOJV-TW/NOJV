import { beforeEach, describe, expect, it, vi } from "vitest";

const { listActiveForUser, listUpcoming, listByCourseIds, listParticipatedContestsForUser } =
  vi.hoisted(() => ({
    listActiveForUser: vi.fn(),
    listUpcoming: vi.fn(),
    listByCourseIds: vi.fn(),
    listParticipatedContestsForUser: vi.fn(),
  }));

vi.mock("@nojv/db", () => ({
  courseMembershipRepo: { listActiveForUser },
  assessmentRepo: { listUpcoming },
  examRepo: { listByCourseIds },
  contestRepo: { listParticipatedContestsForUser },
}));

import { listUpcomingAssessments } from "@nojv/application";

const NOW = new Date("2026-07-08T00:00:00.000Z");
const d = (iso: string) => new Date(iso);

describe("listUpcomingAssessments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listActiveForUser.mockResolvedValue([{ courseId: "c1" }]);
    listUpcoming.mockResolvedValue([]);
    listByCourseIds.mockResolvedValue([]);
    listParticipatedContestsForUser.mockResolvedValue([]);
  });

  it("merges assignments, exams and contests, sorted by open time", async () => {
    listUpcoming.mockResolvedValue([
      {
        id: "a1",
        title: "HW1",
        course: { title: "CS101" },
        opensAt: d("2026-07-10T00:00:00Z"),
        closesAt: d("2026-07-20T00:00:00Z"),
        dueAt: d("2026-07-18T00:00:00Z"),
      },
    ]);
    listByCourseIds.mockResolvedValue([
      {
        id: "e1",
        title: "Midterm",
        course: { title: "CS101" },
        startsAt: d("2026-07-09T00:00:00Z"),
        endsAt: d("2026-07-09T02:00:00Z"),
      },
    ]);
    listParticipatedContestsForUser.mockResolvedValue([
      {
        id: "ct1",
        title: "Weekly",
        startsAt: d("2026-07-12T00:00:00Z"),
        endsAt: d("2026-07-12T02:00:00Z"),
      },
    ]);

    const result = await listUpcomingAssessments("u1", NOW);

    expect(result.map((r) => [r.type, r.id])).toEqual([
      ["exam", "e1"],
      ["assignment", "a1"],
      ["contest", "ct1"],
    ]);
    // exams keep their course; endsAt normalizes into closesAt with dueAt null
    const exam = result.find((r) => r.type === "exam")!;
    expect(exam.courseTitle).toBe("CS101");
    expect(exam.closesAt).toBe("2026-07-09T02:00:00.000Z");
    expect(exam.dueAt).toBeNull();
    // contests are global — no course
    const contest = result.find((r) => r.type === "contest")!;
    expect(contest.courseTitle).toBeNull();
  });

  it("drops exams and contests that have already ended", async () => {
    listByCourseIds.mockResolvedValue([
      {
        id: "e_old",
        title: "Old",
        course: { title: "CS101" },
        startsAt: d("2026-07-01T00:00:00Z"),
        endsAt: d("2026-07-01T02:00:00Z"),
      },
    ]);
    listParticipatedContestsForUser.mockResolvedValue([
      {
        id: "ct_old",
        title: "Past",
        startsAt: d("2026-07-02T00:00:00Z"),
        endsAt: d("2026-07-02T02:00:00Z"),
      },
    ]);

    const result = await listUpcomingAssessments("u1", NOW);
    expect(result).toEqual([]);
  });

  it("skips the exam query when the user has no active courses", async () => {
    listActiveForUser.mockResolvedValue([]);

    await listUpcomingAssessments("u1", NOW);
    expect(listByCourseIds).not.toHaveBeenCalled();
  });
});
