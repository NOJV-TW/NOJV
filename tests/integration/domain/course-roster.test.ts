import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { submissionFeedbackAuditLogRepo } from "@nojv/db";

import {
  ConflictError,
  ForbiddenError,
  courseDomain,
  feedbackDomain,
  scoreOverrideDomain,
  userDomain,
} from "@nojv/application";
import * as courseGrading from "../../../packages/application/src/scoring/course-grading";
import type { ActorContext } from "../../../packages/application/src/shared/actor-context";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const schoolIdentities = [
  { username: "41047001a", email: "41047001a@gapps.ntnu.edu.tw" },
  { username: "ntu_b11902001", email: "b11902001@g.ntu.edu.tw" },
  { username: "ntust_b11902001", email: "b11902001@mail.ntust.edu.tw" },
];

async function classroom() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const course = await createTestCourse({ ownerId: teacher.id });
  const ownerMembership = await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: teacher.id, role: "teacher" },
  });
  const actor: ActorContext = {
    userId: teacher.id,
    username: teacher.username ?? teacher.id,
    displayName: teacher.name,
    email: teacher.email,
    platformRole: teacher.platformRole,
  };
  return { teacher, course, ownerMembership, actor };
}

async function pendingMember(courseId: string, username: string) {
  return testPrisma.courseMembership.findUniqueOrThrow({
    where: { courseId_pendingUsername: { courseId, pendingUsername: username } },
  });
}

async function verificationToken(userId: string, username: string) {
  const result = await userDomain.initiateSchoolVerification(userId, username);
  expect(result.status).toBe("success");
  if (result.status !== "success") throw new Error(result.detail);
  return result.token;
}

async function waitForCourseLockWaiter(holderPid: number) {
  await vi.waitFor(
    async () => {
      const waiters = await testPrisma.$queryRaw<{ pid: number }[]>`
      SELECT waiting.pid
      FROM pg_locks AS waiting
      JOIN pg_locks AS held
        ON held.locktype = waiting.locktype
        AND held.database = waiting.database
        AND held.classid = waiting.classid
        AND held.objid = waiting.objid
        AND held.objsubid = waiting.objsubid
      WHERE held.pid = ${holderPid}
        AND held.locktype = 'advisory'
        AND held.granted
        AND NOT waiting.granted
    `;
      expect(waiters).toHaveLength(1);
    },
    { timeout: 3_000, interval: 10 },
  );
}

describe("roster enrollment and identity binding", () => {
  it.each([
    { school: true, removed: "existing" },
    { school: true, removed: "pending" },
    { school: false, removed: "existing" },
    { school: false, removed: "pending" },
  ])(
    "keeps $removed removal when school=$school identities merge",
    async ({ school, removed }) => {
      const { course, actor } = await classroom();
      const username = school ? "ntu_b11902001" : "correct_alias";
      const user = await createTestUser();
      const existing = await testPrisma.courseMembership.create({
        data: { courseId: course.id, userId: user.id, role: "student" },
      });
      await courseDomain.bulkAddByHandle(actor, course.id, { handles: [username], role: "ta" });
      const pending = await pendingMember(course.id, username);
      const removedId = removed === "existing" ? existing.id : pending.id;
      await courseDomain.removeMember(actor, course.id, removedId);
      const before = await testPrisma.courseMembership.findUniqueOrThrow({
        where: { id: removedId },
      });
      if (school)
        await userDomain.processSchoolVerification(await verificationToken(user.id, username));
      else await userDomain.renameUsername(user.id, username);
      await userDomain.linkUserCourseRoster(user.id);
      const survivorId = school ? pending.id : existing.id;
      expect(
        await testPrisma.courseMembership.findMany({
          where: { courseId: course.id, userId: user.id },
        }),
      ).toMatchObject([{ id: survivorId, status: "removed", removedAt: before.removedAt }]);
      await courseDomain.bulkAddByHandle(actor, course.id, {
        handles: [username],
        role: "student",
      });
      expect(
        await testPrisma.courseMembership.findUnique({ where: { id: survivorId } }),
      ).toMatchObject({ status: "active", removedAt: null, role: "student" });
    },
  );

  it("rejects correction of linked rows, other courses, and unauthorized actors", async () => {
    const { course, actor, ownerMembership } = await classroom();
    await courseDomain.bulkAddByHandle(actor, course.id, {
      handles: ["misspelled"],
      role: "student",
    });
    const pending = await pendingMember(course.id, "misspelled");
    const other = await classroom();
    await expect(
      courseDomain.correctPendingUsername(other.actor, course.id, pending.id, "corrected"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: other.actor.userId, role: "ta" },
    });
    await expect(
      courseDomain.correctPendingUsername(other.actor, course.id, pending.id, "corrected"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      courseDomain.correctPendingUsername(
        other.actor,
        other.course.id,
        pending.id,
        "corrected",
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      courseDomain.correctPendingUsername(actor, course.id, pending.id, "bad username"),
    ).rejects.toMatchObject({ status: 400 });
    const user = await createTestUser();
    const linked = await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: user.id, role: "student" },
    });
    await expect(
      courseDomain.correctPendingUsername(actor, course.id, linked.id, "corrected"),
    ).rejects.toThrow("ROSTER_ALREADY_LINKED");
    await expect(
      courseDomain.correctPendingUsername(actor, course.id, ownerMembership.id, "corrected"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await pendingMember(course.id, "misspelled")).toEqual(pending);
  });

  it.each(["pending", "linked", "removed", "disabled"])(
    "rejects correction into a %s conflict without changing either row",
    async (kind) => {
      const { course, actor } = await classroom();
      await courseDomain.bulkAddByHandle(actor, course.id, {
        handles: ["misspelled"],
        role: "student",
      });
      const pending = await pendingMember(course.id, "misspelled");
      if (kind !== "pending")
        await createTestUser({ username: "corrected", disabled: kind === "disabled" });
      if (kind !== "disabled") {
        await courseDomain.bulkAddByHandle(actor, course.id, {
          handles: ["corrected"],
          role: "student",
        });
        if (kind === "removed")
          await testPrisma.courseMembership.updateMany({
            where: { courseId: course.id, id: { not: pending.id }, role: "student" },
            data: { status: "removed", removedAt: new Date() },
          });
      }
      const before = await testPrisma.courseMembership.findMany({
        where: { courseId: course.id },
        orderBy: { id: "asc" },
      });
      await expect(
        courseDomain.correctPendingUsername(actor, course.id, pending.id, "corrected"),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(
        await testPrisma.courseMembership.findMany({
          where: { courseId: course.id },
          orderBy: { id: "asc" },
        }),
      ).toEqual(before);
    },
  );

  it("serializes competing corrections without merging memberships", async () => {
    const { course, actor } = await classroom();
    await courseDomain.bulkAddByHandle(actor, course.id, {
      handles: ["typo_one", "typo_two"],
      role: "student",
    });
    const rows = await testPrisma.courseMembership.findMany({
      where: { courseId: course.id, role: "student" },
    });
    const results = await Promise.allSettled(
      rows.map((row) =>
        courseDomain.correctPendingUsername(actor, course.id, row.id, "corrected"),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await testPrisma.courseMembership.count({
        where: { courseId: course.id, role: "student" },
      }),
    ).toBe(2);
    expect(
      await testPrisma.courseMembership.count({
        where: { courseId: course.id, pendingUsername: "corrected" },
      }),
    ).toBe(1);
  });

  it.each(["student", "ta"] as const)(
    "corrects a removed %s without restoring it or touching another course",
    async (role) => {
      const { course, actor } = await classroom();
      const other = await classroom();
      await courseDomain.bulkAddByHandle(actor, course.id, { handles: ["misspelled"], role });
      await courseDomain.bulkAddByHandle(other.actor, other.course.id, {
        handles: ["corrected"],
        role,
      });
      const otherPending = await pendingMember(other.course.id, "corrected");
      const pending = await pendingMember(course.id, "misspelled");
      await courseDomain.removeMember(actor, course.id, pending.id);
      const removed = await pendingMember(course.id, "misspelled");
      const user = await createTestUser({ username: "corrected" });
      await courseDomain.correctPendingUsername(actor, course.id, pending.id, "corrected");
      expect(
        await testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
      ).toEqual({
        ...removed,
        pendingUsername: null,
        userId: user.id,
        updatedAt: expect.any(Date),
      });
      expect(await pendingMember(other.course.id, "corrected")).toEqual(otherPending);
      expect(await testPrisma.notification.count({ where: { userId: user.id } })).toBe(0);
    },
  );

  it.each(schoolIdentities)(
    "binds verified school OAuth email $email to $username",
    async ({ username, email }) => {
      const { course, actor } = await classroom();
      await courseDomain.bulkAddByHandle(actor, course.id, {
        handles: [username],
        role: "student",
      });
      const pending = await pendingMember(course.id, username);
      const user = await createTestUser({ username: null, email, emailVerified: true });
      const usersBefore = await testPrisma.user.count();

      await userDomain.linkUserCourseRoster(user.id);
      await userDomain.linkUserCourseRoster(user.id);

      await expect(
        testPrisma.user.findUnique({ where: { id: user.id } }),
      ).resolves.toMatchObject({ id: user.id, username, email });
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
      ).resolves.toMatchObject({
        id: pending.id,
        userId: user.id,
        pendingUsername: null,
        role: "student",
        status: "active",
        joinedAt: pending.joinedAt,
        createdAt: pending.createdAt,
        addedByUserId: actor.userId,
      });
      await expect(testPrisma.user.count()).resolves.toBe(usersBefore);
      await expect(
        testPrisma.participation.count({ where: { userId: user.id } }),
      ).resolves.toBe(0);
      await expect(testPrisma.submission.count({ where: { userId: user.id } })).resolves.toBe(
        0,
      );
    },
  );

  it.each(schoolIdentities)(
    "claims $username by later verification without replacing the user's primary email",
    async ({ username }) => {
      const { course, actor } = await classroom();
      await courseDomain.bulkAddByHandle(actor, course.id, {
        handles: [username],
        role: "student",
      });
      const pending = await pendingMember(course.id, username);
      const user = await createTestUser({
        username: "personal_alias",
        email: "personal@example.com",
      });
      const token = await verificationToken(user.id, username);
      await expect(userDomain.peekSchoolVerification(token)).resolves.toEqual({
        status: "valid",
        username,
      });
      await expect(
        testPrisma.schoolVerificationToken.findUnique({ where: { token } }),
      ).resolves.not.toBeNull();

      await expect(userDomain.processSchoolVerification(token)).resolves.toEqual({
        status: "success",
        username,
      });
      await expect(
        testPrisma.user.findUnique({ where: { id: user.id } }),
      ).resolves.toMatchObject({ id: user.id, username, email: user.email });
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
      ).resolves.toMatchObject({ userId: user.id, pendingUsername: null });
      await expect(
        testPrisma.schoolVerificationToken.findUnique({ where: { token } }),
      ).resolves.toBeNull();
      await expect(userDomain.processSchoolVerification(token)).resolves.toMatchObject({
        status: "error",
      });
    },
  );

  it.each([
    { email: "b11902001@ntu.edu.tw", emailVerified: false },
    { email: "b11902001@ntu.edu.tw.attacker.example", emailVerified: true },
    { email: "alias@ntu.edu.tw", emailVerified: true },
  ])(
    "does not derive school identity from $email with verified=$emailVerified",
    async ({ email, emailVerified }) => {
      const { course, actor } = await classroom();
      await courseDomain.bulkAddByHandle(actor, course.id, {
        handles: ["ntu_b11902001", "ordinary_alias"],
        role: "student",
      });
      const pending = await pendingMember(course.id, "ntu_b11902001");
      const ordinary = await pendingMember(course.id, "ordinary_alias");
      const user = await createTestUser({ username: "ordinary_alias", email, emailVerified });

      await userDomain.linkUserCourseRoster(user.id);
      await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toEqual(
        user,
      );
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
      ).resolves.toEqual(pending);
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: ordinary.id } }),
      ).resolves.toMatchObject({ userId: user.id, pendingUsername: null });
    },
  );

  it.each(["student", "ta"] as const)(
    "automatically binds an authorized general %s username on login",
    async (role) => {
      const { course, actor } = await classroom();
      await courseDomain.bulkAddByHandle(actor, course.id, {
        handles: ["general_member"],
        role,
      });
      const pending = await pendingMember(course.id, "general_member");
      const user = await createTestUser({ username: "general_member" });

      await userDomain.linkUserCourseRoster(user.id);
      const linked = await testPrisma.courseMembership.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(linked).toMatchObject({
        userId: user.id,
        pendingUsername: null,
        role,
        status: pending.status,
        addedByUserId: actor.userId,
        joinedAt: pending.joinedAt,
      });
      await userDomain.linkUserCourseRoster(user.id);
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
      ).resolves.toEqual(linked);
    },
  );

  it("deduplicates simultaneous bulk enrollments and normalized input without creating Users", async () => {
    const { course, actor } = await classroom();
    const usersBefore = await testPrisma.user.count();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        courseDomain.bulkAddByHandle(actor, course.id, {
          handles: [" ALICE ", "alice"],
          role: "ta",
        }),
      ),
    );
    expect(results.reduce((sum, result) => sum + result.added, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.pendingCreated, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.skipped, 0)).toBe(3);
    await expect(
      testPrisma.courseMembership.count({
        where: { courseId: course.id, pendingUsername: "alice" },
      }),
    ).resolves.toBe(1);
    await expect(testPrisma.user.count()).resolves.toBe(usersBefore);
  });

  it("serializes competing username claims with duplicate bulk enrollment", async () => {
    const { course, actor } = await classroom();
    await courseDomain.bulkAddByHandle(actor, course.id, {
      handles: ["shared_alias"],
      role: "ta",
    });
    const pending = await pendingMember(course.id, "shared_alias");
    const first = await createTestUser();
    const second = await createTestUser();
    const [claims] = await Promise.all([
      Promise.allSettled([
        userDomain.renameUsername(first.id, "shared_alias"),
        userDomain.renameUsername(second.id, "shared_alias"),
      ]),
      courseDomain.bulkAddByHandle(actor, course.id, { handles: ["shared_alias"], role: "ta" }),
      courseDomain.bulkAddByHandle(actor, course.id, { handles: ["shared_alias"], role: "ta" }),
    ]);
    expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = claims.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ConflictError);
    const owner = await testPrisma.user.findUniqueOrThrow({
      where: { username: "shared_alias" },
    });
    const loser = owner.id === first.id ? second : first;
    await expect(testPrisma.user.findUnique({ where: { id: loser.id } })).resolves.toEqual(
      loser,
    );
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
    ).resolves.toMatchObject({ userId: owner.id, role: "ta", pendingUsername: null });
    await expect(
      testPrisma.courseMembership.count({
        where: { courseId: course.id, userId: { in: [first.id, second.id] } },
      }),
    ).resolves.toBe(1);
  });

  it("converges concurrent rename, repeated token, login, and bulk calls on one school row", async () => {
    const { course, actor } = await classroom();
    const username = "ntu_b11902001";
    await courseDomain.bulkAddByHandle(actor, course.id, {
      handles: [username],
      role: "student",
    });
    const pending = await pendingMember(course.id, username);
    const user = await createTestUser();
    const token = await verificationToken(user.id, username);
    const [rename, first, repeated, bulk, login] = await Promise.allSettled([
      userDomain.renameUsername(user.id, "temporary_alias"),
      userDomain.processSchoolVerification(token),
      userDomain.processSchoolVerification(token),
      courseDomain.bulkAddByHandle(actor, course.id, { handles: [username], role: "student" }),
      userDomain.linkUserCourseRoster(user.id),
    ]);
    if (rename.status === "rejected")
      expect(rename.reason).toMatchObject({ message: "VERIFIED_LOCKED" });
    expect(first.status).toBe("fulfilled");
    expect(repeated.status).toBe("fulfilled");
    const tokenResults = [first, repeated].map((result) =>
      result.status === "fulfilled" ? result.value.status : "rejected",
    );
    expect(tokenResults.sort()).toEqual(["error", "success"]);
    expect(bulk.status).toBe("fulfilled");
    expect(login.status).toBe("fulfilled");
    await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject(
      { username },
    );
    await expect(
      testPrisma.courseMembership.findMany({ where: { courseId: course.id, userId: user.id } }),
    ).resolves.toMatchObject([{ id: pending.id, pendingUsername: null }]);
    await expect(
      testPrisma.schoolVerificationToken.findUnique({ where: { token } }),
    ).resolves.toBeNull();
  });

  it.each(["login", "verification"] as const)(
    "does not reactivate a removed pending row during %s or retries",
    async (entrypoint) => {
      const { course, actor } = await classroom();
      const username = entrypoint === "login" ? "general_member" : "ntu_b11902001";
      await courseDomain.bulkAddByHandle(actor, course.id, {
        handles: [username],
        role: "student",
      });
      const pending = await pendingMember(course.id, username);
      await courseDomain.removeMember(actor, course.id, pending.id);
      const removed = await testPrisma.courseMembership.findUniqueOrThrow({
        where: { id: pending.id },
      });
      const user = await createTestUser({ username: entrypoint === "login" ? username : null });
      if (entrypoint === "verification") {
        const token = await verificationToken(user.id, username);
        await expect(userDomain.processSchoolVerification(token)).resolves.toMatchObject({
          status: "success",
        });
      }
      await userDomain.linkUserCourseRoster(user.id);
      await userDomain.linkUserCourseRoster(user.id);
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
      ).resolves.toMatchObject({
        userId: user.id,
        pendingUsername: null,
        status: "removed",
        removedAt: removed.removedAt,
        joinedAt: removed.joinedAt,
      });
      await expect(
        testPrisma.notification.count({ where: { userId: user.id, type: "course_enrolled" } }),
      ).resolves.toBe(0);
      await expect(
        courseDomain.bulkAddByHandle(actor, course.id, {
          handles: [username],
          role: "student",
        }),
      ).resolves.toMatchObject({ added: 1, reactivated: 1 });
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
      ).resolves.toMatchObject({ status: "active", removedAt: null });
    },
  );

  it("school verification keeps a removed TA roster row over an active personal student row", async () => {
    const { course, actor } = await classroom();
    const user = await createTestUser();
    const existing = await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: user.id, role: "student" },
    });
    await courseDomain.bulkAddByHandle(actor, course.id, {
      handles: ["ntu_b11902001"],
      role: "ta",
    });
    const pending = await pendingMember(course.id, "ntu_b11902001");
    await courseDomain.removeMember(actor, course.id, pending.id);
    const removed = await testPrisma.courseMembership.findUniqueOrThrow({
      where: { id: pending.id },
    });
    const token = await verificationToken(user.id, "ntu_b11902001");

    await expect(userDomain.processSchoolVerification(token)).resolves.toMatchObject({
      status: "success",
    });
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: existing.id } }),
    ).resolves.toBeNull();
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
    ).resolves.toMatchObject({
      userId: user.id,
      role: "ta",
      status: "removed",
      removedAt: removed.removedAt,
      pendingUsername: null,
    });
    await userDomain.linkUserCourseRoster(user.id);
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
    ).resolves.toMatchObject({ status: "removed", role: "ta" });
  });

  it.each(["owner", "teacher"] as const)(
    "school binding preserves a protected %s membership",
    async (kind) => {
      const { teacher, course, ownerMembership, actor } = await classroom();
      const user =
        kind === "owner" ? teacher : await createTestUser({ platformRole: "teacher" });
      const protectedMember =
        kind === "owner"
          ? ownerMembership
          : await testPrisma.courseMembership.create({
              data: {
                courseId: course.id,
                userId: user.id,
                role: "teacher",
                status: "removed",
                removedAt: new Date("2026-01-01T00:00:00Z"),
              },
            });
      await courseDomain.bulkAddByHandle(actor, course.id, {
        handles: ["ntu_b11902001"],
        role: "student",
      });
      const pending = await pendingMember(course.id, "ntu_b11902001");
      const token = await verificationToken(user.id, "ntu_b11902001");
      await expect(userDomain.processSchoolVerification(token)).resolves.toMatchObject({
        status: "success",
      });
      await expect(
        testPrisma.courseMembership.findMany({
          where: { courseId: course.id, userId: user.id },
        }),
      ).resolves.toMatchObject([
        {
          id: pending.id,
          role: "teacher",
          status: protectedMember.status,
          removedAt: protectedMember.removedAt,
        },
      ]);
      await expect(
        testPrisma.course.findUnique({ where: { id: course.id } }),
      ).resolves.toMatchObject({ ownerId: course.ownerId });
    },
  );

  it("does not consume a token or change its user when another account claims the school identity first", async () => {
    const first = await createTestUser();
    const second = await createTestUser();
    const firstToken = await verificationToken(first.id, "ntu_b11902001");
    const secondToken = await verificationToken(second.id, "ntu_b11902001");
    await expect(userDomain.processSchoolVerification(secondToken)).resolves.toMatchObject({
      status: "success",
    });
    await expect(userDomain.processSchoolVerification(firstToken)).resolves.toMatchObject({
      status: "error",
    });
    await expect(testPrisma.user.findUnique({ where: { id: first.id } })).resolves.toEqual(
      first,
    );
    await expect(
      testPrisma.schoolVerificationToken.findUnique({ where: { token: firstToken } }),
    ).resolves.not.toBeNull();
  });

  it("rejects verification for an account disabled after token issuance", async () => {
    const user = await createTestUser();
    const token = await verificationToken(user.id, "ntu_b11902001");
    const disabled = await testPrisma.user.update({
      where: { id: user.id },
      data: { disabled: true },
    });
    await expect(userDomain.processSchoolVerification(token)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toEqual(
      disabled,
    );
    await expect(
      testPrisma.schoolVerificationToken.findUnique({ where: { token } }),
    ).resolves.not.toBeNull();
  });

  it("only consumes an expired token on confirmation and never changes identity", async () => {
    const user = await createTestUser();
    const token = await verificationToken(user.id, "ntu_b11902001");
    const expired = await testPrisma.schoolVerificationToken.update({
      where: { token },
      data: { expiresAt: new Date("2000-01-01T00:00:00Z") },
    });
    await expect(userDomain.peekSchoolVerification(token)).resolves.toMatchObject({
      status: "error",
    });
    await expect(
      testPrisma.schoolVerificationToken.findUnique({ where: { token } }),
    ).resolves.toEqual(expired);
    await expect(userDomain.processSchoolVerification(token)).resolves.toMatchObject({
      status: "error",
    });
    await expect(
      testPrisma.schoolVerificationToken.findUnique({ where: { token } }),
    ).resolves.toBeNull();
    await expect(testPrisma.user.findUnique({ where: { id: user.id } })).resolves.toEqual(user);
  });
});

describe.each(["teacher", "ta"] as const)("%s grading during identity changes", (role) => {
  it.each(["rename", "verify"] as const)(
    "%s waits for grading without locking its actor's User foreign keys",
    async (operation) => {
      const room = await classroom();
      const grader = role === "teacher" ? room.teacher : await createTestUser();
      const linked =
        role === "teacher"
          ? room.ownerMembership
          : await testPrisma.courseMembership.create({
              data: { courseId: room.course.id, userId: grader.id, role },
            });
      const username = operation === "rename" ? "renamed_grader" : "ntu_b11902001";
      await courseDomain.bulkAddByHandle(room.actor, room.course.id, {
        handles: [username],
        role: "ta",
      });
      const pending = await pendingMember(room.course.id, username);
      const student = await testPrisma.courseMembership.create({
        data: { courseId: room.course.id, pendingUsername: "graded_student", role: "student" },
      });
      const problem = await createTestProblem({ authorId: room.teacher.id });
      const assignment = await testPrisma.assessment.create({
        data: {
          courseId: room.course.id,
          createdByUserId: room.teacher.id,
          title: "Grading while the actor changes username",
          summary: "",
          status: "published",
          opensAt: new Date("2026-01-01T00:00:00Z"),
          closesAt: new Date("2026-01-02T00:00:00Z"),
          problems: { create: { problemId: problem.id, ordinal: 0 } },
        },
      });
      const token =
        operation === "verify" ? await verificationToken(grader.id, username) : null;
      const actor: ActorContext = {
        userId: grader.id,
        username: grader.username ?? grader.id,
        displayName: grader.name,
        email: grader.email,
        platformRole: grader.platformRole,
      };
      let reportLocked!: (pid: number) => void;
      const locked = new Promise<number>((resolve) => {
        reportLocked = resolve;
      });
      let resume!: () => void;
      const resumed = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const lockContext = courseGrading.lockCourseGradingContext;
      const spy = vi
        .spyOn(courseGrading, "lockCourseGradingContext")
        .mockImplementation(async (tx, context, actor) => {
          const courseId = await lockContext(tx, context, actor);
          const [backend] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          if (!backend) throw new Error("Missing grading transaction backend pid.");
          reportLocked(backend.pid);
          await resumed;
          return courseId;
        });
      const grading = scoreOverrideDomain.createOverride(actor, {
        context: { type: "assignment", assignmentId: assignment.id },
        courseMembershipId: student.id,
        problemId: problem.id,
        overrideScore: 90,
        reason: "Graded during identity change",
      });
      void grading.catch(() => undefined);
      let identity: Promise<unknown> | undefined;
      try {
        const holderPid = await Promise.race([
          locked,
          grading.then(() => {
            throw new Error("Grading completed before the course-lock barrier.");
          }),
        ]);
        identity = token
          ? userDomain.processSchoolVerification(token)
          : userDomain.renameUsername(grader.id, username);
        void identity.catch(() => undefined);
        await waitForCourseLockWaiter(holderPid);
      } finally {
        resume();
        await Promise.allSettled([grading, identity]);
        spy.mockRestore();
      }

      await expect(identity).resolves.toEqual(
        operation === "verify" ? { status: "success", username } : { merged: true },
      );
      await expect(grading).resolves.toMatchObject({
        courseMembershipId: student.id,
        createdByUserId: grader.id,
        updatedByUserId: grader.id,
        overrideScore: 90,
      });
      const grade = await grading;
      await expect(
        testPrisma.scoreOverride.findUnique({ where: { id: grade.id } }),
      ).resolves.toEqual(grade);
      await expect(
        testPrisma.scoreOverrideAuditLog.findMany({ where: { overrideId: grade.id } }),
      ).resolves.toEqual([
        expect.objectContaining({
          overrideId: grade.id,
          courseMembershipId: student.id,
          sourceMembershipId: student.id,
          changedByUserId: grader.id,
          action: "create",
          newScore: 90,
          newReason: grade.reason,
        }),
      ]);
      await expect(
        testPrisma.user.findUnique({ where: { id: grader.id } }),
      ).resolves.toMatchObject({
        username,
        email: grader.email,
      });
      await expect(
        testPrisma.courseMembership.findMany({
          where: { courseId: room.course.id, userId: grader.id },
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          id: operation === "verify" ? pending.id : linked.id,
          userId: grader.id,
          pendingUsername: null,
          role,
          status: "active",
        }),
      ]);
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: student.id } }),
      ).resolves.toEqual(student);
      if (token) {
        await expect(
          testPrisma.schoolVerificationToken.findUnique({ where: { token } }),
        ).resolves.toBeNull();
      }
    },
    15_000,
  );
});

async function mergeFixture(type: "assignment" | "exam", username = "ntu_b11902001") {
  const room = await classroom();
  const user = await createTestUser({
    username: "personal_alias",
    email: "personal@example.com",
  });
  const account = await testPrisma.account.create({
    data: {
      id: randomUUID(),
      accountId: `oauth-${user.id}`,
      providerId: "github",
      userId: user.id,
      accessToken: "existing-oauth-token",
    },
  });
  const existing = await testPrisma.courseMembership.create({
    data: {
      courseId: room.course.id,
      userId: user.id,
      role: "student",
      addedByUserId: room.teacher.id,
    },
  });
  await courseDomain.bulkAddByHandle(room.actor, room.course.id, {
    handles: [username],
    role: "student",
  });
  const pending = await pendingMember(room.course.id, username);
  const problem = await createTestProblem({ authorId: room.teacher.id });
  const extraProblem = await createTestProblem({ authorId: room.teacher.id });
  const startsAt = new Date("2026-01-01T00:00:00Z");
  const endsAt = new Date("2026-01-02T00:00:00Z");
  const context =
    type === "assignment"
      ? await testPrisma.assessment.create({
          data: {
            courseId: room.course.id,
            title: "Roster assignment",
            summary: "",
            createdByUserId: room.teacher.id,
            opensAt: startsAt,
            closesAt: endsAt,
            status: "published",
          },
        })
      : await createTestExam({
          courseId: room.course.id,
          createdByUserId: room.teacher.id,
          startsAt,
          endsAt,
        });
  const feedbackContext =
    type === "assignment" ? { assessmentId: context.id } : { examId: context.id };
  const gradingContext =
    type === "assignment"
      ? { type: "assignment" as const, assignmentId: context.id }
      : { type: "exam" as const, examId: context.id };
  if (type === "assignment") {
    await testPrisma.assessmentProblem.createMany({
      data: [problem, extraProblem].map((p, ordinal) => ({
        assessmentId: context.id,
        problemId: p.id,
        ordinal,
      })),
    });
  } else {
    await testPrisma.examProblem.createMany({
      data: [problem, extraProblem].map((p, ordinal) => ({
        examId: context.id,
        problemId: p.id,
        ordinal,
      })),
    });
    await testPrisma.participation.create({
      data: {
        type: "exam",
        examId: context.id,
        userId: user.id,
        status: "submitted",
        score: 80,
      },
    });
  }
  const submission = await createTestSubmission({
    userId: user.id,
    problemId: problem.id,
    score: 80,
    ...(type === "assignment"
      ? { assessmentId: context.id, courseId: room.course.id }
      : { examId: context.id }),
  });

  async function evidence(
    memberId: string,
    historicalUserId: string | null,
    problemId: string,
    score: number,
    comment: string,
    createdAt: Date,
  ) {
    const override = await testPrisma.scoreOverride.create({
      data: {
        courseMembershipId: memberId,
        problemId,
        contextType: type,
        contextId: context.id,
        overrideScore: score,
        reason: comment,
        createdByUserId: room.teacher.id,
        updatedByUserId: room.teacher.id,
        createdAt,
        updatedAt: createdAt,
      },
    });
    const feedback = await testPrisma.submissionFeedback.create({
      data: {
        courseMembershipId: memberId,
        problemId,
        ...feedbackContext,
        comment,
        authorUserId: room.teacher.id,
        createdAt,
        updatedAt: createdAt,
      },
    });
    const scoreAudit = await testPrisma.scoreOverrideAuditLog.create({
      data: {
        overrideId: override.id,
        courseMembershipId: memberId,
        userId: historicalUserId,
        problemId,
        contextType: type,
        contextId: context.id,
        action: "create",
        newScore: score,
        newReason: comment,
        changedByUserId: room.teacher.id,
        createdAt,
      },
    });
    const feedbackAudit = await testPrisma.submissionFeedbackAuditLog.create({
      data: {
        feedbackId: feedback.id,
        courseMembershipId: memberId,
        studentUserId: historicalUserId,
        problemId,
        ...feedbackContext,
        action: "create",
        newComment: comment,
        changedByUserId: room.teacher.id,
        createdAt,
      },
    });
    return { override, feedback, scoreAudit, feedbackAudit };
  }

  const personal = await evidence(
    existing.id,
    user.id,
    problem.id,
    80,
    "Personal account assessment",
    new Date("2026-01-03T00:00:00Z"),
  );
  const school = await evidence(
    pending.id,
    null,
    problem.id,
    90,
    "School roster assessment",
    new Date("2026-01-04T00:00:00Z"),
  );
  const extra = await evidence(
    existing.id,
    user.id,
    extraProblem.id,
    70,
    "Nonconflicting work",
    new Date("2026-01-05T00:00:00Z"),
  );
  return {
    ...room,
    user,
    account,
    existing,
    pending,
    problem,
    context,
    gradingContext,
    feedbackContext,
    submission,
    personal,
    school,
    extra,
  };
}

async function mergeSnapshot(fixture: Awaited<ReturnType<typeof mergeFixture>>) {
  const { user, course, context, feedbackContext } = fixture;
  const orderBy = { id: "asc" } as const;
  const [
    identity,
    accounts,
    memberships,
    scores,
    feedback,
    scoreHistory,
    feedbackHistory,
    tokens,
    submissions,
    participations,
    work,
    notifications,
  ] = await Promise.all([
    testPrisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    testPrisma.account.findMany({ where: { userId: user.id }, orderBy }),
    testPrisma.courseMembership.findMany({ where: { courseId: course.id }, orderBy }),
    testPrisma.scoreOverride.findMany({ where: { contextId: context.id }, orderBy }),
    testPrisma.submissionFeedback.findMany({ where: feedbackContext, orderBy }),
    testPrisma.scoreOverrideAuditLog.findMany({ where: { contextId: context.id }, orderBy }),
    testPrisma.submissionFeedbackAuditLog.findMany({ where: feedbackContext, orderBy }),
    testPrisma.schoolVerificationToken.findMany({
      where: { userId: user.id },
      orderBy: { token: "asc" },
    }),
    testPrisma.submission.findMany({ where: { userId: user.id }, orderBy }),
    testPrisma.participation.findMany({ where: { userId: user.id }, orderBy }),
    testPrisma.durableWork.findMany({ orderBy }),
    testPrisma.notification.findMany({ where: { userId: user.id }, orderBy }),
  ]);
  return {
    identity,
    accounts,
    memberships,
    scores,
    feedback,
    scoreHistory,
    feedbackHistory,
    tokens,
    submissions,
    participations,
    work,
    notifications,
  };
}

describe("identity merge preserves grading evidence", () => {
  it.each(["assignment", "exam"] as const)(
    "school verification keeps the %s roster's 90 over the personal account's 80",
    async (type) => {
      const fixture = await mergeFixture(type);
      const {
        user,
        account,
        pending,
        existing,
        personal,
        school,
        extra,
        context,
        submission,
        gradingContext,
      } = fixture;
      const token = await verificationToken(user.id, "ntu_b11902001");
      const before = await mergeSnapshot(fixture);

      await expect(userDomain.processSchoolVerification(token)).resolves.toMatchObject({
        status: "success",
        username: "ntu_b11902001",
      });
      await expect(
        testPrisma.courseMembership.findUnique({ where: { id: existing.id } }),
      ).resolves.toBeNull();
      await expect(
        testPrisma.courseMembership.findMany({
          where: { courseId: fixture.course.id, userId: user.id },
        }),
      ).resolves.toMatchObject([
        {
          id: pending.id,
          pendingUsername: null,
          role: pending.role,
          status: pending.status,
          joinedAt: pending.joinedAt,
          addedByUserId: pending.addedByUserId,
        },
      ]);
      await expect(
        testPrisma.scoreOverride.findUnique({ where: { id: school.override.id } }),
      ).resolves.toEqual(school.override);
      await expect(
        testPrisma.scoreOverride.findUnique({ where: { id: personal.override.id } }),
      ).resolves.toBeNull();
      await expect(
        testPrisma.submissionFeedback.findUnique({ where: { id: school.feedback.id } }),
      ).resolves.toEqual(school.feedback);
      await expect(
        testPrisma.submissionFeedback.findUnique({ where: { id: personal.feedback.id } }),
      ).resolves.toBeNull();
      await expect(
        testPrisma.scoreOverride.findUnique({ where: { id: extra.override.id } }),
      ).resolves.toEqual({ ...extra.override, courseMembershipId: pending.id });
      await expect(
        testPrisma.submissionFeedback.findUnique({ where: { id: extra.feedback.id } }),
      ).resolves.toEqual({ ...extra.feedback, courseMembershipId: pending.id });

      await expect(
        testPrisma.scoreOverrideAuditLog.findUnique({ where: { id: personal.scoreAudit.id } }),
      ).resolves.toEqual({
        ...personal.scoreAudit,
        overrideId: school.override.id,
        courseMembershipId: pending.id,
        sourceMembershipId: existing.id,
      });
      await expect(
        testPrisma.submissionFeedbackAuditLog.findUnique({
          where: { id: personal.feedbackAudit.id },
        }),
      ).resolves.toEqual({
        ...personal.feedbackAudit,
        feedbackId: school.feedback.id,
        courseMembershipId: pending.id,
        sourceMembershipId: existing.id,
      });
      await expect(
        testPrisma.scoreOverrideAuditLog.findUnique({ where: { id: school.scoreAudit.id } }),
      ).resolves.toEqual(school.scoreAudit);
      await expect(
        testPrisma.submissionFeedbackAuditLog.findUnique({
          where: { id: school.feedbackAudit.id },
        }),
      ).resolves.toEqual(school.feedbackAudit);
      await expect(
        testPrisma.scoreOverrideAuditLog.findUnique({ where: { id: extra.scoreAudit.id } }),
      ).resolves.toEqual({
        ...extra.scoreAudit,
        courseMembershipId: pending.id,
        sourceMembershipId: existing.id,
      });
      await expect(
        testPrisma.submissionFeedbackAuditLog.findUnique({
          where: { id: extra.feedbackAudit.id },
        }),
      ).resolves.toEqual({
        ...extra.feedbackAudit,
        courseMembershipId: pending.id,
        sourceMembershipId: existing.id,
      });
      await expect(
        testPrisma.scoreOverrideAuditLog.findMany({
          where: { contextId: context.id, action: "merge" },
        }),
      ).resolves.toMatchObject([
        {
          courseMembershipId: pending.id,
          sourceMembershipId: existing.id,
          oldScore: 80,
          newScore: 90,
          oldReason: personal.override.reason,
          newReason: school.override.reason,
        },
      ]);
      await expect(
        testPrisma.submissionFeedbackAuditLog.findMany({
          where: { ...fixture.feedbackContext, action: "merge" },
        }),
      ).resolves.toMatchObject([
        {
          courseMembershipId: pending.id,
          sourceMembershipId: existing.id,
          oldComment: personal.feedback.comment,
          newComment: school.feedback.comment,
        },
      ]);
      const visibleFeedback = await feedbackDomain.getFeedbackForStudent(
        user.id,
        gradingContext,
      );
      expect(visibleFeedback.map((row) => row.id).sort()).toEqual(
        [school.feedback.id, extra.feedback.id].sort(),
      );
      const effectiveOverride = await testPrisma.scoreOverride.findUniqueOrThrow({
        where: { id: school.override.id },
        include: { auditLogs: true },
      });
      expect(effectiveOverride.auditLogs.map((row) => row.id)).toEqual(
        expect.arrayContaining([personal.scoreAudit.id, school.scoreAudit.id]),
      );
      expect(effectiveOverride.auditLogs).toHaveLength(3);
      const feedbackHistory = await submissionFeedbackAuditLogRepo.listForFeedback(
        school.feedback.id,
      );
      expect(feedbackHistory.map((row) => row.id)).toEqual(
        expect.arrayContaining([personal.feedbackAudit.id, school.feedbackAudit.id]),
      );
      expect(feedbackHistory).toHaveLength(3);
      await expect(
        testPrisma.account.findUnique({ where: { id: account.id } }),
      ).resolves.toEqual(account);
      await expect(
        testPrisma.submission.findUnique({ where: { id: submission.id } }),
      ).resolves.toEqual(submission);
      await expect(
        testPrisma.participation.findMany({
          where: { userId: user.id },
          orderBy: { id: "asc" },
        }),
      ).resolves.toEqual(before.participations);
      const convergence = await testPrisma.durableWork.findMany({
        where: { kind: "score.converge" },
      });
      expect(convergence).toHaveLength(type === "exam" ? 1 : 0);
      if (type === "exam")
        expect(convergence[0]?.payload).toEqual({
          context: { type: "exam", examId: context.id },
          userId: user.id,
        });

      const after = await mergeSnapshot(fixture);
      await userDomain.linkUserCourseRoster(user.id);
      await expect(mergeSnapshot(fixture)).resolves.toEqual(after);
    },
  );

  it("general rename keeps the linked row's score, feedback, role and removed status", async () => {
    const fixture = await mergeFixture("assignment", "general_alias");
    const { user, existing, pending, personal, school } = fixture;
    const removed = await testPrisma.courseMembership.update({
      where: { id: existing.id },
      data: { status: "removed", removedAt: new Date("2026-01-06T00:00:00Z") },
    });
    await testPrisma.courseMembership.update({
      where: { id: pending.id },
      data: { role: "ta" },
    });

    await expect(userDomain.renameUsername(user.id, "general_alias")).resolves.toEqual({
      merged: true,
    });
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
    ).resolves.toBeNull();
    await expect(
      testPrisma.courseMembership.findUnique({ where: { id: existing.id } }),
    ).resolves.toMatchObject({
      id: existing.id,
      userId: user.id,
      role: "student",
      status: "removed",
      removedAt: removed.removedAt,
      joinedAt: existing.joinedAt,
    });
    await expect(
      testPrisma.scoreOverride.findUnique({ where: { id: personal.override.id } }),
    ).resolves.toEqual(personal.override);
    await expect(
      testPrisma.submissionFeedback.findUnique({ where: { id: personal.feedback.id } }),
    ).resolves.toEqual(personal.feedback);
    await expect(
      testPrisma.scoreOverrideAuditLog.findUnique({ where: { id: school.scoreAudit.id } }),
    ).resolves.toEqual({
      ...school.scoreAudit,
      overrideId: personal.override.id,
      courseMembershipId: existing.id,
      sourceMembershipId: pending.id,
    });
    await expect(
      testPrisma.submissionFeedbackAuditLog.findUnique({
        where: { id: school.feedbackAudit.id },
      }),
    ).resolves.toEqual({
      ...school.feedbackAudit,
      feedbackId: personal.feedback.id,
      courseMembershipId: existing.id,
      sourceMembershipId: pending.id,
    });
    const effectiveOverride = await testPrisma.scoreOverride.findUniqueOrThrow({
      where: { id: personal.override.id },
      include: { auditLogs: true },
    });
    expect(effectiveOverride.auditLogs.map((row) => row.id)).toEqual(
      expect.arrayContaining([personal.scoreAudit.id, school.scoreAudit.id]),
    );
    expect(effectiveOverride.auditLogs).toHaveLength(3);
    const feedbackHistory = await submissionFeedbackAuditLogRepo.listForFeedback(
      personal.feedback.id,
    );
    expect(feedbackHistory.map((row) => row.id)).toEqual(
      expect.arrayContaining([personal.feedbackAudit.id, school.feedbackAudit.id]),
    );
    expect(feedbackHistory).toHaveLength(3);
  });

  it.each(["assignment", "exam"] as const)(
    "rolls back username, token and both %s grading histories when confirmation fails",
    async (type) => {
      const fixture = await mergeFixture(type);
      const token = await verificationToken(fixture.user.id, "ntu_b11902001");
      const before = await mergeSnapshot(fixture);
      const trigger = `test_roster_failure_${randomUUID().replaceAll("-", "")}`;
      await testPrisma.$executeRawUnsafe(
        `CREATE FUNCTION "${trigger}"() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected roster confirmation failure'; END; $$`,
      );
      try {
        await testPrisma.$executeRawUnsafe(
          `CREATE TRIGGER "${trigger}" BEFORE DELETE ON "SchoolVerificationToken" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
        );
        await expect(userDomain.processSchoolVerification(token)).rejects.toThrow(
          /injected roster confirmation failure/,
        );
        await expect(mergeSnapshot(fixture)).resolves.toEqual(before);
      } finally {
        await testPrisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${trigger}" ON "SchoolVerificationToken"`,
        );
        await testPrisma.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);
      }
      await expect(userDomain.processSchoolVerification(token)).resolves.toMatchObject({
        status: "success",
      });
      await expect(
        testPrisma.scoreOverride.findUnique({ where: { id: fixture.school.override.id } }),
      ).resolves.toMatchObject({ overrideScore: 90 });
      await expect(
        testPrisma.schoolVerificationToken.findUnique({ where: { token } }),
      ).resolves.toBeNull();
    },
  );
});
