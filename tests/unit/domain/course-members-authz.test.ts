import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../../../packages/application/src/shared/actor-context";

const mocks = vi.hoisted(() => ({
  listWithUserByCourse: vi.fn(),
  findActorMembership: vi.fn(),
  findMember: vi.fn(),
  findCourse: vi.fn(),
  findUsers: vi.fn(),
  listMembers: vi.fn(),
  createMembers: vi.fn(),
  restoreMembers: vi.fn(),
  updateRole: vi.fn(),
  removeFromCourse: vi.fn(),
  lock: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  courseRepo: { withTx: () => ({ findById: mocks.findCourse }) },
  courseMembershipRepo: { withTx: () => ({ findByComposite: mocks.findActorMembership }) },
  courseMembershipAdminRepo: {
    listWithUserByCourse: mocks.listWithUserByCourse,
    withTx: () => ({ updateRole: mocks.updateRole, removeFromCourse: mocks.removeFromCourse }),
  },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({
      $executeRaw: mocks.lock,
      $queryRaw: mocks.lock,
      user: { findMany: mocks.findUsers },
      courseMembership: {
        findUnique: mocks.findMember,
        findMany: mocks.listMembers,
        createManyAndReturn: mocks.createMembers,
        updateManyAndReturn: mocks.restoreMembers,
      },
    }),
}));

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../packages/application/src/shared/errors";
import {
  bulkAddByHandle,
  listMembersForCourse,
  changeMemberRole,
  parseHandleInput,
  removeMember,
} from "../../../packages/application/src/course/members";
import { canManageMembers } from "../../../packages/application/src/shared/permissions";

const COURSE = "course-1";
const MEMBER = "membership-1";
const actor: ActorContext = {
  userId: "actor-1",
  username: "teacher",
  platformRole: "teacher",
  displayName: "Teacher",
  email: "teacher@example.com",
};
const admin: ActorContext = { ...actor, platformRole: "admin" };
const member = {
  id: MEMBER,
  courseId: COURSE,
  userId: "student-1",
  role: "student",
  course: { ownerId: "owner-1" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findActorMembership.mockResolvedValue({ role: "teacher", status: "active" });
  mocks.findMember.mockResolvedValue(member);
  mocks.findCourse.mockResolvedValue({ id: COURSE, ownerId: "owner-1" });
  mocks.findUsers.mockResolvedValue([]);
  mocks.listMembers.mockResolvedValue([]);
  mocks.createMembers.mockResolvedValue([{ id: MEMBER, userId: null }]);
});

describe("member authorization", () => {
  it("restricts role/removal management to teachers and admins", () => {
    for (const role of ["admin", "teacher"] as const) expect(canManageMembers(role)).toBe(true);
    for (const role of ["ta", "student", null] as const)
      expect(canManageMembers(role)).toBe(false);
  });

  for (const operation of ["change role", "remove"] as const) {
    const mutate = (acting: ActorContext) =>
      operation === "change role"
        ? changeMemberRole(acting, COURSE, MEMBER, "ta")
        : removeMember(acting, COURSE, MEMBER);

    describe(operation, () => {
      it.each([
        null,
        { role: "student", status: "active" },
        { role: "ta", status: "active" },
        { role: "teacher", status: "removed" },
      ])("denies a non-managing membership %j", async (membership) => {
        mocks.findActorMembership.mockResolvedValue(membership);
        await expect(mutate(actor)).rejects.toBeInstanceOf(ForbiddenError);
        expect(mocks.updateRole).not.toHaveBeenCalled();
        expect(mocks.removeFromCourse).not.toHaveBeenCalled();
      });

      it.each(["student-1", null])(
        "lets a teacher manage linked or pending student %j by membership ID",
        async (userId) => {
          mocks.findMember.mockResolvedValue({ ...member, userId });
          await mutate(actor);
          if (operation === "change role") {
            expect(mocks.updateRole).toHaveBeenCalledWith(COURSE, MEMBER, "ta");
          } else {
            expect(mocks.removeFromCourse).toHaveBeenCalledWith(COURSE, MEMBER);
          }
        },
      );

      it.each([actor, admin])(
        "protects the course owner even from an admin",
        async (acting) => {
          mocks.findMember.mockResolvedValue({ ...member, userId: "owner-1", role: "teacher" });
          await expect(mutate(acting)).rejects.toThrow(/course owner/i);
          expect(mocks.updateRole).not.toHaveBeenCalled();
          expect(mocks.removeFromCourse).not.toHaveBeenCalled();
        },
      );

      it.each(["other-teacher", actor.userId])(
        "protects teacher membership %s from a teacher",
        async (userId) => {
          mocks.findMember.mockResolvedValue({ ...member, role: "teacher", userId });
          await expect(mutate(actor)).rejects.toBeInstanceOf(ForbiddenError);
          expect(mocks.updateRole).not.toHaveBeenCalled();
          expect(mocks.removeFromCourse).not.toHaveBeenCalled();
        },
      );

      it("rejects a membership outside the requested course", async () => {
        mocks.findMember.mockResolvedValue(null);
        await expect(mutate(admin)).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.findMember).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: MEMBER, courseId: COURSE },
          }),
        );
        expect(mocks.updateRole).not.toHaveBeenCalled();
        expect(mocks.removeFromCourse).not.toHaveBeenCalled();
      });

      it("lets an admin manage a teacher who is not the owner", async () => {
        mocks.findMember.mockResolvedValue({ ...member, role: "teacher" });
        await mutate(admin);
        expect(
          operation === "change role" ? mocks.updateRole : mocks.removeFromCourse,
        ).toHaveBeenCalledOnce();
      });
    });
  }

  it("only lets an admin promote a pending student to teacher", async () => {
    mocks.findMember.mockResolvedValue({ ...member, userId: null });
    await expect(changeMemberRole(actor, COURSE, MEMBER, "teacher")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mocks.updateRole).not.toHaveBeenCalled();
    await changeMemberRole(admin, COURSE, MEMBER, "teacher");
    expect(mocks.updateRole).toHaveBeenCalledWith(COURSE, MEMBER, "teacher");
  });
});

describe("bulk roster authorization and input", () => {
  it.each([
    ["student", "student"],
    ["ta", "ta"],
    ["ta", "teacher"],
    ["teacher", "teacher"],
  ] as const)("denies course %s enrollment of %s", async (actorRole, requestedRole) => {
    mocks.findActorMembership.mockResolvedValue({ role: actorRole, status: "active" });
    await expect(
      bulkAddByHandle(actor, COURSE, { handles: ["alice"], role: requestedRole }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.createMembers).not.toHaveBeenCalled();
    expect(mocks.restoreMembers).not.toHaveBeenCalled();
  });

  it("allows a TA to enroll students", async () => {
    mocks.findActorMembership.mockResolvedValue({ role: "ta", status: "active" });
    await expect(
      bulkAddByHandle(actor, COURSE, { handles: ["alice"], role: "student" }),
    ).resolves.toEqual({
      added: 1,
      pendingCreated: 1,
      skipped: 0,
      reactivated: 0,
    });
    expect(mocks.createMembers).toHaveBeenCalledOnce();
  });

  it("does not let a teacher restore a removed teacher as a student", async () => {
    mocks.listMembers.mockResolvedValue([
      {
        id: MEMBER,
        courseId: COURSE,
        userId: null,
        pendingUsername: "alice",
        role: "teacher",
        status: "removed",
      },
    ]);
    await expect(
      bulkAddByHandle(actor, COURSE, { handles: ["alice"], role: "student" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.restoreMembers).not.toHaveBeenCalled();
  });

  it.each(
    [[], ["ab"], ["has space"], ["b11902001"], ["ntnu_41047001a"], ["ntu_41047001a"]].map(
      (handles) => ({ handles }),
    ),
  )(
    "rejects malformed or noncanonical school enrollment %j before writes",
    async ({ handles }) => {
      await expect(
        bulkAddByHandle(actor, COURSE, { handles, role: "student" }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mocks.lock).not.toHaveBeenCalled();
      expect(mocks.createMembers).not.toHaveBeenCalled();
    },
  );

  it("normalizes separators and case without inventing school prefixes", () => {
    expect(
      parseHandleInput("  41047001A, NTU_B11902001;\nntust_b11902001 alice ALICE "),
    ).toEqual(["41047001a", "ntu_b11902001", "ntust_b11902001", "alice"]);
  });
});

describe("listMembersForCourse", () => {
  it("preserves configured avatars and leaves pending member images empty", async () => {
    const base = {
      role: "student",
      status: "active",
      joinedAt: new Date("2026-09-07T00:00:00Z"),
      removedAt: null,
    };
    mocks.listWithUserByCourse.mockResolvedValue([
      {
        ...base,
        id: "linked",
        userId: "student-1",
        pendingUsername: null,
        user: {
          name: "Student",
          username: "student",
          email: "student@example.test",
          image: "https://example.test/avatar.png",
        },
      },
      { ...base, id: "pending", userId: null, pendingUsername: "newcomer", user: null },
    ]);
    expect(await listMembersForCourse(COURSE)).toEqual([
      expect.objectContaining({
        membershipId: "linked",
        image: "https://example.test/avatar.png",
        isPending: false,
      }),
      expect.objectContaining({ membershipId: "pending", image: null, isPending: true }),
    ]);
  });
});
