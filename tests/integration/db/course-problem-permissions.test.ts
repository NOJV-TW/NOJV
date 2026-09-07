import { describe, expect, it } from "vitest";
import { courseProblemRepo, runTransaction } from "@nojv/db";
import { courseDomain, examDomain } from "@nojv/application";
import {
  assertProblemContentReadAccess,
  assertProblemOwnership,
  canProblemContentEdit,
  canProblemContentRead,
  lockProblemForEdit,
} from "../../../packages/application/src/problem/permissions";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function fixture() {
  const owner = await createTestUser({ platformRole: "teacher" });
  const staff = await createTestUser();
  const course = await createTestCourse({ ownerId: owner.id });
  const problem = await createTestProblem({ authorId: owner.id, visibility: "private" });
  const membership = await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: staff.id, role: "ta" },
  });
  await testPrisma.courseProblem.create({
    data: { courseId: course.id, problemId: problem.id, addedByUserId: owner.id },
  });
  if (!staff.username) throw new Error("Staff fixture requires a username.");
  const actor = {
    userId: staff.id,
    username: staff.username,
    platformRole: staff.platformRole,
  };
  return { owner, staff, course, problem, membership, actor };
}

describe("course problem permissions", () => {
  it("revokes exam monitoring from removed creators", async () => {
    const f = await fixture();
    const exam = await createTestExam({ courseId: f.course.id, createdByUserId: f.staff.id });
    const actor = { ...f.actor, email: f.staff.email, displayName: f.staff.name };
    await expect(examDomain.listExamIpViolationsForActor(actor, exam.id)).resolves.toEqual([]);
    await testPrisma.courseMembership.update({
      where: { id: f.membership.id },
      data: { status: "removed" },
    });
    await expect(examDomain.listExamIpViolationsForActor(actor, exam.id)).rejects.toThrow(
      /Not authorized/,
    );
  });

  it.each(["remove", "demote", "archive"] as const)(
    "%s waits for authorized content writes and prevents subsequent edits",
    async (operation) => {
      const f = await fixture();
      await testPrisma.courseMembership.create({
        data: { courseId: f.course.id, userId: f.owner.id, role: "teacher" },
      });
      if (!f.owner.username) throw new Error("Owner fixture requires a username.");
      const ownerActor = {
        userId: f.owner.id,
        username: f.owner.username,
        platformRole: f.owner.platformRole,
        email: f.owner.email,
        displayName: f.owner.name,
      };
      let markLocked!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const edit = runTransaction(async (tx) => {
        await lockProblemForEdit(tx, f.actor, f.problem.id);
        markLocked();
        await released;
        await tx.problem.update({
          where: { id: f.problem.id },
          data: { title: "Saved before revocation" },
        });
      });
      await locked;
      const revoke =
        operation === "remove"
          ? courseDomain.removeMember(ownerActor, f.course.id, f.membership.id)
          : operation === "demote"
            ? courseDomain.changeMemberRole(ownerActor, f.course.id, f.membership.id, "student")
            : courseDomain.setCourseArchived(ownerActor, f.course.id, true);
      try {
        await expect
          .poll(async () => {
            const rows = await testPrisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Course%'
          `;
            return Number(rows[0]?.count);
          })
          .toBeGreaterThan(0);
      } finally {
        release();
      }
      await Promise.all([edit, revoke]);
      await expect(
        runTransaction((tx) => lockProblemForEdit(tx, f.actor, f.problem.id)),
      ).rejects.toThrow(/Not permitted/);
      expect(
        await testPrisma.problem.findUnique({ where: { id: f.problem.id } }),
      ).toMatchObject({ title: "Saved before revocation" });
    },
  );

  it("grants private authoring to bound active staff while ownership remains independent", async () => {
    const f = await fixture();
    await expect(assertProblemContentReadAccess(f.actor, f.problem.id)).resolves.toMatchObject({
      id: f.problem.id,
    });
    await expect(
      runTransaction((tx) => lockProblemForEdit(tx, f.actor, f.problem.id)),
    ).resolves.toMatchObject({ id: f.problem.id });
    expect(() => assertProblemOwnership(f.problem, f.actor)).toThrow();

    for (const data of [
      { role: "student" as const },
      { role: "teacher" as const, status: "removed" as const },
      {
        role: "ta" as const,
        status: "active" as const,
        userId: null,
        pendingUsername: f.staff.username,
      },
    ]) {
      await testPrisma.courseMembership.update({ where: { id: f.membership.id }, data });
      await expect(canProblemContentRead(f.problem, f.actor)).resolves.toBe(false);
      await expect(
        runTransaction((tx) => lockProblemForEdit(tx, f.actor, f.problem.id)),
      ).rejects.toThrow(/Not permitted/);
    }
    await testPrisma.courseMembership.update({
      where: { id: f.membership.id },
      data: { userId: f.staff.id, pendingUsername: null, role: "teacher", status: "active" },
    });
    await testPrisma.course.update({ where: { id: f.course.id }, data: { archived: true } });
    await expect(canProblemContentRead(f.problem, f.actor)).resolves.toBe(true);
    await expect(canProblemContentEdit(f.problem, f.actor)).resolves.toBe(false);
    await expect(
      runTransaction((tx) => lockProblemForEdit(tx, f.actor, f.problem.id)),
    ).rejects.toThrow();
    const ownerActor = { ...f.actor, userId: f.owner.id };
    await expect(
      runTransaction((tx) => lockProblemForEdit(tx, ownerActor, f.problem.id)),
    ).resolves.toMatchObject({ id: f.problem.id });

    await testPrisma.course.update({ where: { id: f.course.id }, data: { archived: false } });
    const publicProblem = await testPrisma.problem.update({
      where: { id: f.problem.id },
      data: { visibility: "public" },
    });
    await expect(canProblemContentRead(publicProblem, f.actor)).resolves.toBe(false);
    await expect(
      runTransaction((tx) => lockProblemForEdit(tx, f.actor, f.problem.id)),
    ).rejects.toThrow();
    await expect(
      runTransaction((tx) =>
        lockProblemForEdit(tx, { ...f.actor, platformRole: "admin" }, f.problem.id),
      ),
    ).resolves.toMatchObject({ id: f.problem.id });

    const unrelated = await createTestProblem({ authorId: f.owner.id, visibility: "private" });
    const otherCourse = await createTestCourse({ ownerId: f.owner.id });
    await testPrisma.courseProblem.create({
      data: { courseId: otherCourse.id, problemId: unrelated.id },
    });
    await expect(canProblemContentRead(unrelated, f.actor)).resolves.toBe(false);
  });

  it("rechecks sharing after waiting for a course revocation transaction", async () => {
    const f = await fixture();
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revoke = runTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${f.course.id} FOR UPDATE`;
      await courseProblemRepo.withTx(tx).remove(f.course.id, f.problem.id);
      locked();
      await gate;
    });
    await ready;
    const edit = runTransaction((tx) => lockProblemForEdit(tx, f.actor, f.problem.id));
    const rejected = expect(edit).rejects.toThrow(/Not permitted/);
    try {
      await expect
        .poll(async () => {
          const rows = await testPrisma.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Course%'`;
          return Number(rows[0]?.count);
        })
        .toBeGreaterThan(0);
    } finally {
      release();
    }
    await revoke;
    await rejected;
  });
});
