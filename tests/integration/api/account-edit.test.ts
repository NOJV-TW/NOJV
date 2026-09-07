import { describe, expect, it, vi } from "vitest";
import { userRepo } from "@nojv/db";
import { ConflictError, ForbiddenError, userDomain } from "@nojv/application";

import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

describe("account edits preserve user and roster identity", () => {
  it("trims a display name without changing account identity", async () => {
    const user = await createTestUser({ name: "Old Name" });
    await userDomain.renameName(user.id, "  New Name  ");
    await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject(
      {
        id: user.id,
        name: "New Name",
        username: user.username,
        email: user.email,
      },
    );
  });

  it("normalizes an unused general username", async () => {
    const user = await createTestUser();
    await expect(userDomain.renameUsername(user.id, "  New.Handle-1  ")).resolves.toEqual({
      merged: false,
    });
    await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject(
      {
        username: "new.handle-1",
        displayUsername: "new.handle-1",
      },
    );
  });

  it.each(["student", "ta"] as const)(
    "username setup claims a pending %s row without creating another user",
    async (role) => {
      const course = await createTestCourse();
      const pending = await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          pendingUsername: "new_member",
          role,
          addedByUserId: course.ownerId,
        },
      });
      const user = await createTestUser({ username: null });
      const usersBefore = await testPrisma.user.count();

      await expect(userDomain.renameUsername(user.id, "NEW_MEMBER")).resolves.toEqual({
        merged: true,
      });
      await expect(
        testPrisma.user.findUnique({ where: { id: user.id } }),
      ).resolves.toMatchObject({ username: "new_member" });
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
      ).resolves.toMatchObject({
        id: pending.id,
        userId: user.id,
        pendingUsername: null,
        role,
        addedByUserId: pending.addedByUserId,
        joinedAt: pending.joinedAt,
        createdAt: pending.createdAt,
      });
      await expect(testPrisma.user.count()).resolves.toBe(usersBefore);
    },
  );

  it.each(["41047001a", "ntu_b11902001", "ntust_b11902001"])(
    "locks an already-verified username %s",
    async (username) => {
      const user = await createTestUser({ username });
      await expect(userDomain.renameUsername(user.id, "anything")).rejects.toThrow(
        "VERIFIED_LOCKED",
      );
      await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toEqual(
        user,
      );
    },
  );

  it.each([false, true])(
    "rejects another actual user's name even when disabled=%s",
    async (disabled) => {
      const owner = await createTestUser({ username: "taken_name", disabled });
      const user = await createTestUser();
      await expect(userDomain.renameUsername(user.id, "taken_name")).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toEqual(
        user,
      );
      await expect(testPrisma.user.findUnique({ where: { id: owner.id } })).resolves.toEqual(
        owner,
      );
    },
  );

  it("rejects disabled users without taking a pending membership", async () => {
    const course = await createTestCourse();
    const pending = await testPrisma.courseMembership.create({
      data: { courseId: course.id, pendingUsername: "pending_name", role: "student" },
    });
    const user = await createTestUser({ disabled: true });
    await expect(userDomain.renameUsername(user.id, "pending_name")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
    ).resolves.toEqual(pending);
    await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toEqual(user);
  });

  it("retries roster binding when the requested username is unchanged", async () => {
    const course = await createTestCourse();
    const user = await createTestUser({ username: "same_name" });
    const pending = await testPrisma.courseMembership.create({
      data: { courseId: course.id, pendingUsername: "same_name", role: "ta" },
    });
    await expect(userDomain.renameUsername(user.id, "same_name")).resolves.toEqual({
      merged: true,
    });
    await expect(userDomain.renameUsername(user.id, "same_name")).resolves.toEqual({
      merged: false,
    });
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
    ).resolves.toMatchObject({ userId: user.id, pendingUsername: null, role: "ta" });
  });

  it("reusing a released alias cannot take the previous owner's membership", async () => {
    const course = await createTestCourse();
    const original = await createTestUser({ username: "old_alias" });
    const membership = await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: original.id, role: "ta" },
    });
    await userDomain.renameUsername(original.id, "new_alias");
    const newcomer = await createTestUser({ username: "old_alias" });
    await userDomain.linkUserCourseRoster(newcomer.id);
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: membership.id } }),
    ).resolves.toEqual(membership);
    await expect(
      testPrisma.courseMembership.count({ where: { userId: newcomer.id } }),
    ).resolves.toBe(0);
  });

  it.each(["active", "removed"] as const)(
    "soft-deletes an account with a %s membership and preserves its owner",
    async (status) => {
      const course = await createTestCourse();
      const user = await createTestUser({ username: "deleted_alias", name: "Student" });
      const membership = await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: user.id,
          role: "student",
          status,
          removedAt: status === "removed" ? new Date() : null,
        },
      });
      await expect(userDomain.deleteUser(true, user.id)).resolves.toEqual({
        mode: "soft",
        name: "Student",
      });
      await expect(
        testPrisma.user.findUnique({ where: { id: user.id } }),
      ).resolves.toMatchObject({
        disabled: true,
        username: null,
        name: "Deleted user",
        email: `deleted+${user.id}@deleted.nojv.local`,
      });
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: membership.id } }),
      ).resolves.toEqual(membership);
      await expect(userDomain.linkUserCourseRoster(user.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const replacement = await createTestUser({ username: "deleted_alias" });
      await userDomain.linkUserCourseRoster(replacement.id);
      await expect(
        testPrisma.courseMembership.count({ where: { userId: replacement.id } }),
      ).resolves.toBe(0);
    },
  );

  it.each([false, true])(
    "blocks new User foreign keys after deletion counts, with existing submission=%s",
    async (hasSubmission) => {
      const user = await createTestUser();
      const problem = await createTestProblem();
      const submission = hasSubmission
        ? await createTestSubmission({ userId: user.id, problemId: problem.id })
        : null;
      let reportCount!: (count: number) => void;
      const counted = new Promise<number>((resolve) => {
        reportCount = resolve;
      });
      let resume!: () => void;
      const resumed = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const withTx = userRepo.withTx;
      const spy = vi.spyOn(userRepo, "withTx").mockImplementation((tx) => {
        const users = withTx(tx);
        return {
          ...users,
          async countDeletionBlockers(userId) {
            const count = await users.countDeletionBlockers(userId);
            if (userId === user.id) {
              reportCount(count);
              await resumed;
            }
            return count;
          },
        };
      });
      const deletion = userDomain.deleteUser(true, user.id);
      const settled = deletion.then(
        () => undefined,
        () => undefined,
      );
      try {
        const count = await Promise.race([
          counted,
          deletion.then(() => {
            throw new Error("Deletion completed before the blocker-count barrier.");
          }),
        ]);
        expect(count).toBe(hasSubmission ? 1 : 0);
        await expect(
          testPrisma.$transaction(
            (tx) =>
              tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR KEY SHARE NOWAIT`,
          ),
        ).rejects.toMatchObject({
          code: "P2010",
          meta: { driverAdapterError: { cause: { originalCode: "55P03" } } },
        });
      } finally {
        resume();
        await settled;
        spy.mockRestore();
      }

      await expect(deletion).resolves.toEqual({
        mode: hasSubmission ? "soft" : "hard",
        name: user.name,
      });
      if (submission) {
        await expect(
          testPrisma.user.findUnique({ where: { id: user.id } }),
        ).resolves.toMatchObject({
          disabled: true,
          username: null,
          email: `deleted+${user.id}@deleted.nojv.local`,
        });
        await expect(
          testPrisma.submission.findUnique({ where: { id: submission.id } }),
        ).resolves.toEqual(submission);
      } else {
        await expect(
          testPrisma.user.findUnique({ where: { id: user.id } }),
        ).resolves.toBeNull();
        await expect(
          createTestSubmission({ userId: user.id, problemId: problem.id }),
        ).rejects.toMatchObject({ code: "P2003" });
      }
    },
    15_000,
  );
});
