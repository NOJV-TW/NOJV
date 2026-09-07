import { describe, expect, it } from "vitest";
import { runTransaction, userRepo } from "@nojv/db";

import { createTestCourse, createTestUser, testPrisma } from "../../fixtures/factories";

describe("roster identity persistence", () => {
  it.each(["41047001a", "ntu_b11902001", "ntust_b11902001", "alice_ta"])(
    "stores pending username %s without creating an authentication identity",
    async (pendingUsername) => {
      const course = await createTestCourse();
      const usersBefore = await testPrisma.user.count();
      const accountsBefore = await testPrisma.account.count();
      const membership = await testPrisma.courseMembership.create({
        data: { courseId: course.id, pendingUsername, role: "student" },
      });

      expect(membership).toMatchObject({ userId: null, pendingUsername, status: "active" });
      await expect(userRepo.findByUsername(pendingUsername)).resolves.toBeNull();
      await expect(testPrisma.user.count()).resolves.toBe(usersBefore);
      await expect(testPrisma.account.count()).resolves.toBe(accountsBefore);
    },
  );

  it("looks up actual users independently of pending roster rows", async () => {
    const user = await createTestUser({ username: "alice" });
    await expect(userRepo.findByUsername("alice")).resolves.toMatchObject({ id: user.id });
    await expect(userRepo.findByUsername("not_registered")).resolves.toBeNull();
  });

  it.each(["neither", "both"] as const)(
    "rejects a membership with %s identity fields",
    async (mode) => {
      const course = await createTestCourse();
      const user = await createTestUser();
      await expect(
        testPrisma.courseMembership.create({
          data: {
            courseId: course.id,
            role: "student",
            userId: mode === "both" ? user.id : null,
            pendingUsername: mode === "both" ? "alice" : null,
          },
        }),
      ).rejects.toThrow(/CourseMembership_identity_chk|check constraint/i);
      await expect(
        testPrisma.courseMembership.count({ where: { courseId: course.id } }),
      ).resolves.toBe(0);
    },
  );

  it("allows the same pending username in different courses but never duplicate rows in one course", async () => {
    const first = await createTestCourse();
    const second = await createTestCourse();
    const data = { courseId: first.id, pendingUsername: "alice", role: "student" } as const;
    const original = await testPrisma.courseMembership.create({ data });
    await expect(testPrisma.courseMembership.create({ data })).rejects.toMatchObject({
      code: "P2002",
    });
    await testPrisma.courseMembership.create({ data: { ...data, courseId: second.id } });
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: original.id } }),
    ).resolves.toEqual(original);
    await expect(
      testPrisma.courseMembership.count({ where: { pendingUsername: "alice" } }),
    ).resolves.toBe(2);
  });

  it("restricts deleting an actual user referenced by a membership", async () => {
    const course = await createTestCourse();
    const user = await createTestUser();
    const membership = await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: user.id, role: "student" },
    });
    await expect(
      runTransaction((tx) => userRepo.withTx(tx).delete(user.id)),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(userRepo.findById(user.id)).resolves.toMatchObject({ id: user.id });
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: membership.id } }),
    ).resolves.toEqual(membership);
  });
});
