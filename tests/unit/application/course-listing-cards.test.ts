import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listActiveForUser: vi.fn(),
  findManyForCards: vi.fn(),
  groupOpen: vi.fn(),
  groupDraft: vi.fn(),
  groupUpcomingExams: vi.fn(),
}));

vi.mock("@nojv/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nojv/db")>()),
  courseMembershipRepo: { listActiveForUser: mocks.listActiveForUser },
  courseRepo: { findManyForCards: mocks.findManyForCards },
  assessmentRepo: {
    groupOpenCountsByCourse: mocks.groupOpen,
    groupDraftCountsByCourse: mocks.groupDraft,
  },
  examRepo: { groupUpcomingCountsByCourse: mocks.groupUpcomingExams },
}));

import { listForUserWithCards } from "../../../packages/application/src/course/queries";

function course(id: string) {
  return {
    id,
    title: id,
    description: "",
    owner: { name: "Owner" },
    academicYear: null,
    semester: null,
    _count: { memberships: 3, assessments: 1, exams: 0 },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listActiveForUser.mockResolvedValue([
    { courseId: "enrolled", role: "student", status: "active" },
    { courseId: "managed", role: "ta", status: "active" },
  ]);
  mocks.findManyForCards.mockResolvedValue([course("enrolled"), course("managed")]);
  mocks.groupOpen.mockResolvedValue([]);
  mocks.groupUpcomingExams.mockResolvedValue([]);
  mocks.groupDraft.mockImplementation(async (courseIds: string[]) =>
    courseIds.map((courseId) => ({ courseId, _count: { _all: 2 } })),
  );
});

it("counts draft assignments only for courses the user manages", async () => {
  const { enrolled, managing } = await listForUserWithCards("user-1");

  expect(enrolled).toEqual([
    expect.objectContaining({ id: "enrolled", draftAssignments: null }),
  ]);
  expect(managing).toEqual([expect.objectContaining({ id: "managed", draftAssignments: 2 })]);
  expect(mocks.groupDraft).toHaveBeenCalledWith(["managed"]);
});
