import { describe, expect, it } from "vitest";

import { userRepo } from "@nojv/db";

import { createTestCourse, createTestUser, testPrisma } from "../../fixtures/factories";

// Each test creates its own handle to avoid unique-constraint races
// between cases; `beforeEach` truncate from integration-setup.ts also
// wipes the User table, so the same string is safe in separate tests.
function uniqueHandle(): string {
  return `ntu_b${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

describe("userRepo.findByUsername + createPlaceholder", () => {
  it("round-trips a placeholder row", async () => {
    const handle = uniqueHandle();

    const placeholder = await userRepo.createPlaceholder({
      username: handle,
      addedByUserId: null
    });

    expect(placeholder.username).toBe(handle);
    expect(placeholder.displayUsername).toBe(handle);
    expect(placeholder.name).toBe(handle);
    expect(placeholder.status).toBe("pending_first_login");
    expect(placeholder.disabled).toBe(false);
    expect(placeholder.email).toBe(`placeholder+${handle}@placeholder.nojv.local`);
    expect(placeholder.platformRole).toBe("student");

    const found = await userRepo.findByUsername(handle);
    expect(found?.id).toBe(placeholder.id);
  });

  it("placeholder rows have no Account — they cannot be logged into directly", async () => {
    const handle = uniqueHandle();
    const placeholder = await userRepo.createPlaceholder({
      username: handle,
      addedByUserId: null
    });
    const accounts = await testPrisma.account.findMany({ where: { userId: placeholder.id } });
    expect(accounts).toHaveLength(0);
  });
});

describe("userRepo.attachPlaceholderToAuth", () => {
  it("transfers course memberships from placeholder to real user and deletes the placeholder", async () => {
    const handle = uniqueHandle();

    // Teacher adds the placeholder to a course.
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const placeholder = await userRepo.createPlaceholder({
      username: handle,
      addedByUserId: teacher.id
    });
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: placeholder.id,
        role: "student",
        status: "active",
        addedByUserId: teacher.id
      }
    });

    // Student signs in via OAuth; better-auth creates a real user.
    const realUser = await createTestUser({
      email: "student@example.com",
      username: null,
      name: "Real Student"
    });

    await userRepo.attachPlaceholderToAuth(placeholder.id, realUser.id);

    // Placeholder is gone.
    expect(await testPrisma.user.findUnique({ where: { id: placeholder.id } })).toBeNull();

    // Membership now points at the real user.
    const memberships = await testPrisma.courseMembership.findMany({
      where: { courseId: course.id }
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.userId).toBe(realUser.id);
  });

  it("drops the duplicate placeholder membership when the real user is already in the course", async () => {
    const handle = uniqueHandle();
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });

    // Real user joins the course first.
    const realUser = await createTestUser({ email: "dup@example.com", username: null });
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: realUser.id,
        role: "student",
        status: "active"
      }
    });

    // Teacher unknowingly pastes the handle too, creating a placeholder
    // + second membership row.
    const placeholder = await userRepo.createPlaceholder({
      username: handle,
      addedByUserId: teacher.id
    });
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: placeholder.id,
        role: "student",
        status: "active",
        addedByUserId: teacher.id
      }
    });

    await userRepo.attachPlaceholderToAuth(placeholder.id, realUser.id);

    // Exactly one membership for the real user survives.
    const memberships = await testPrisma.courseMembership.findMany({
      where: { courseId: course.id, userId: realUser.id }
    });
    expect(memberships).toHaveLength(1);
    // Placeholder row is gone.
    expect(await testPrisma.user.findUnique({ where: { id: placeholder.id } })).toBeNull();
  });

  it("rewrites `addedBy` back-references so audit history points at the real user", async () => {
    const handle = uniqueHandle();
    // The placeholder ends up being an adder on some other membership
    // row. Realistically this only happens if we later grant
    // `createPlaceholder` a TA role — but the repo helper still needs
    // to rewrite the FK so we can delete the placeholder cleanly.
    const placeholder = await userRepo.createPlaceholder({
      username: handle,
      addedByUserId: null
    });
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const someoneElse = await createTestUser();
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: someoneElse.id,
        role: "student",
        status: "active",
        addedByUserId: placeholder.id
      }
    });

    const realUser = await createTestUser({ email: "real@example.com", username: null });
    await userRepo.attachPlaceholderToAuth(placeholder.id, realUser.id);

    const updated = await testPrisma.courseMembership.findFirst({
      where: { courseId: course.id, userId: someoneElse.id }
    });
    expect(updated?.addedByUserId).toBe(realUser.id);
  });

  it("refuses to merge a row into itself", async () => {
    const handle = uniqueHandle();
    const placeholder = await userRepo.createPlaceholder({
      username: handle,
      addedByUserId: null
    });
    await expect(
      userRepo.attachPlaceholderToAuth(placeholder.id, placeholder.id)
    ).rejects.toThrow();
  });
});
