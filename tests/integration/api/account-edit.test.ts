import { describe, expect, it } from "vitest";

import { userDomain } from "@nojv/domain";
import { userRepo } from "@nojv/db";

import { createTestCourse, createTestUser, testPrisma } from "../../fixtures/factories";

describe("account edit — rename name + username", () => {
  it("renameName updates User.name", async () => {
    const user = await createTestUser({ name: "Old Name" });

    await userDomain.renameName(user.id, "New Name");

    const fetched = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(fetched!.name).toBe("New Name");
  });

  it("renameUsername on non-verified user updates DB and returns merged: false", async () => {
    // Factory default username is `test_<ts>_<n>` — not a student-ID format,
    // so the user is non-verified.
    const user = await createTestUser();

    const result = await userDomain.renameUsername(user.id, "new_handle");

    expect(result).toEqual({ merged: false });
    const fetched = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(fetched!.username).toBe("new_handle");
    expect(fetched!.displayUsername).toBe("new_handle");
  });

  it("renameUsername into a placeholder merges memberships and deletes placeholder", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });

    // Placeholder handle the teacher bulk-pasted into the course.
    const placeholderHandle = "pending_student_1";
    const placeholder = await userRepo.createPlaceholder({
      username: placeholderHandle,
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

    // Real (non-verified) user renames into the placeholder's handle.
    const realUser = await createTestUser();
    const result = await userDomain.renameUsername(realUser.id, placeholderHandle);

    expect(result).toEqual({ merged: true });

    const fetchedReal = await testPrisma.user.findUnique({ where: { id: realUser.id } });
    expect(fetchedReal!.username).toBe(placeholderHandle);

    expect(await testPrisma.user.findUnique({ where: { id: placeholder.id } })).toBeNull();

    const memberships = await testPrisma.courseMembership.findMany({
      where: { courseId: course.id }
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.userId).toBe(realUser.id);
  });

  it("renameUsername on verified user rejects with VERIFIED_LOCKED", async () => {
    // `41047001a` matches the NTNU student-ID regex → user is considered verified.
    const user = await createTestUser({ username: "41047001a" });

    await expect(userDomain.renameUsername(user.id, "anything")).rejects.toThrow(
      "VERIFIED_LOCKED"
    );
  });
});
