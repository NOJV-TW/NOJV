import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), listMembers: vi.fn() }));
vi.mock("sveltekit-superforms", () => import("sveltekit-superforms/server"));
vi.mock("$lib/server/auth", async (original) => ({
  ...(await original<typeof import("$lib/server/auth")>()),
  getCoursePermissionRole: mocks.permission,
}));
vi.mock("@nojv/application", async (original) => {
  const actual = await original<typeof import("@nojv/application")>();
  return {
    ...actual,
    courseDomain: { ...actual.courseDomain, listMembersForCourse: mocks.listMembers },
  };
});

import { load } from "../../../apps/web/src/routes/(app)/courses/[courseId]/members/+page.server";

const ACTOR_ID = "actor-1";

function row(membershipId: string, overrides: Record<string, unknown>) {
  return {
    membershipId,
    userId: `${membershipId}-user`,
    name: membershipId,
    username: membershipId,
    image: null,
    email: `${membershipId}@example.test`,
    role: "student",
    status: "active",
    isPending: false,
    isOwner: false,
    joinedAt: "2026-09-01T00:00:00.000Z",
    removedAt: null,
    ...overrides,
  };
}

async function loadAs(platformRole: "admin" | "teacher", courseRole: string, archived = false) {
  mocks.permission.mockResolvedValue(courseRole);
  const url = new URL("http://localhost/courses/course_1/members");
  const data = await load({
    params: { courseId: "course_1" },
    url,
    request: new Request(url),
    locals: { sessionUser: { id: ACTOR_ID, username: "actor", platformRole } },
    parent: async () => ({ course: { id: "course_1", archived }, isManager: true }),
  } as never);
  if (!data) throw new Error("No load data");
  return {
    ...data,
    byId: Object.fromEntries(data.members.map((member) => [member.membershipId, member])),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listMembers.mockResolvedValue([
    row("owner", { role: "teacher", isOwner: true }),
    row("co-teacher", { role: "teacher" }),
    row("pending-teacher", { role: "teacher", userId: null, isPending: true }),
    row("ta", { role: "ta" }),
    row("student", {}),
  ]);
});

it("offers an effective admin every action the server allows except on the owner", async () => {
  const data = await loadAs("admin", "admin");
  expect(data.canAssignTeacher).toBe(true);
  expect(data.byId.owner).toMatchObject({ canRemove: false, canChangeRole: false });
  expect(data.byId["co-teacher"]).toMatchObject({ canRemove: true, canChangeRole: true });
  expect(data.byId["pending-teacher"]).toMatchObject({
    canRemove: true,
    canChangeRole: true,
    canCorrectUsername: true,
  });
  expect(data.byId.ta).toMatchObject({ canRemove: true, canChangeRole: true });
});

it("keeps teacher rows read-only for a course teacher", async () => {
  const data = await loadAs("teacher", "teacher");
  expect(data.canAssignTeacher).toBe(false);
  for (const id of ["owner", "co-teacher", "pending-teacher"]) {
    expect(data.byId[id]).toMatchObject({
      canRemove: false,
      canChangeRole: false,
      canCorrectUsername: false,
    });
  }
  expect(data.byId.ta).toMatchObject({ canRemove: true, canChangeRole: true });
  expect(data.byId.student).toMatchObject({ canRemove: true, canChangeRole: true });
});

it("lets a TA remove students only", async () => {
  const data = await loadAs("teacher", "ta");
  expect(data.byId.student).toMatchObject({ canRemove: true, canChangeRole: false });
  expect(data.byId.ta).toMatchObject({ canRemove: false, canChangeRole: false });
  expect(data.byId["co-teacher"]).toMatchObject({ canRemove: false, canChangeRole: false });
});

it("offers no roster writes on an archived course", async () => {
  const data = await loadAs("admin", "admin", true);
  expect(data.canAddMembers).toBe(false);
  for (const member of data.members) {
    expect(member).toMatchObject({
      canRemove: false,
      canChangeRole: false,
      canCorrectUsername: false,
    });
  }
  expect((await loadAs("admin", "admin")).canAddMembers).toBe(true);
});
