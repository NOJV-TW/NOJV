import { describe, expect, it } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";

import { ForbiddenError, plagiarismDomain } from "@nojv/domain";

import { assertCanManagePlagiarism } from "../../../apps/web/src/lib/server/plagiarism-pair";
import {
  createTestContest,
  createTestCourse,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

import type { ActorContext } from "../../../packages/domain/src/shared/actor-context";

/**
 * Route-level permission gate coverage for the 4 plagiarism HTTP endpoints
 * (per `docs/specs/plagiarism.md`). The HTTP wrappers are thin — testing
 * `assertCanManagePlagiarism` (web helper) + `flagPair`/`unflagPair`
 * (domain) hits the exact production gate the route delegates to.
 */

type SessionRole = ActorContext["platformRole"];

interface SessionLike {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  username: string | null;
  platformRole: SessionRole;
  disabled?: boolean;
  status?: "active" | "disabled" | "deleted";
}

function stubEvent(user: SessionLike | null): RequestEvent {
  return {
    locals: { sessionUser: user },
  } as unknown as RequestEvent;
}

function sessionFor(user: {
  id: string;
  name: string;
  email: string;
  username: string;
  platformRole: SessionRole;
}): SessionLike {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    username: user.username,
    platformRole: user.platformRole,
  };
}

function actorFor(user: {
  id: string;
  name: string;
  email: string;
  username: string;
  platformRole: SessionRole;
}): ActorContext {
  return {
    userId: user.id,
    email: user.email,
    username: user.username,
    displayName: user.name,
    platformRole: user.platformRole,
  };
}

async function addCourseMember(
  courseId: string,
  userId: string,
  role: "teacher" | "ta" | "student",
) {
  await testPrisma.courseMembership.create({
    data: { courseId, userId, role, status: "active", joinedAt: new Date() },
  });
}

async function makeAssignment(courseId: string, createdByUserId: string) {
  return testPrisma.assessment.create({
    data: {
      courseId,
      createdByUserId,
      title: "Plagiarism HW",
      summary: "for tests",
      status: "published",
      opensAt: new Date(Date.now() - 7200_000),
      closesAt: new Date(Date.now() - 3600_000),
    },
  });
}

async function setupFlagPair() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const course = await createTestCourse({ ownerId: teacher.id });
  await addCourseMember(course.id, teacher.id, "teacher");
  const assignment = await makeAssignment(course.id, teacher.id);
  const problem = await createTestProblem({ authorId: teacher.id });
  const userA = await createTestUser({ platformRole: "student" });
  const userB = await createTestUser({ platformRole: "student" });
  const pairKey = plagiarismDomain.buildPairKey(userA.id, userB.id, problem.id);
  return { teacher, course, assignment, pairKey };
}

async function setupFlag() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const course = await createTestCourse({ ownerId: teacher.id });
  await addCourseMember(course.id, teacher.id, "teacher");
  const assignment = await makeAssignment(course.id, teacher.id);
  const problem = await createTestProblem({ authorId: teacher.id });
  const userA = await createTestUser({ platformRole: "student" });
  const userB = await createTestUser({ platformRole: "student" });
  const pairKey = plagiarismDomain.buildPairKey(userA.id, userB.id, problem.id);
  const flag = await plagiarismDomain.flagPair(actorFor(teacher), {
    contextType: "assessment",
    contextId: assignment.id,
    pairKey,
  });
  return { teacher, course, assignment, flag };
}

describe("plagiarism API permission gates (real DB)", () => {
  describe("POST /api/plagiarism/[assignmentId]/reports gate", () => {
    it("rejects a student in the same course with ForbiddenError", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });
      await addCourseMember(course.id, teacher.id, "teacher");
      const student = await createTestUser({ platformRole: "student" });
      await addCourseMember(course.id, student.id, "student");
      const assignment = await makeAssignment(course.id, teacher.id);

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(student)), resolved, "denied"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects a teacher of a DIFFERENT course with ForbiddenError", async () => {
      const ownerA = await createTestUser({ platformRole: "teacher" });
      const courseA = await createTestCourse({ ownerId: ownerA.id });
      await addCourseMember(courseA.id, ownerA.id, "teacher");
      const assignment = await makeAssignment(courseA.id, ownerA.id);

      const otherTeacher = await createTestUser({ platformRole: "teacher" });
      const courseB = await createTestCourse({ ownerId: otherTeacher.id });
      await addCourseMember(courseB.id, otherTeacher.id, "teacher");

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(otherTeacher)), resolved, "denied"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects an anonymous request (401 via requireApiAuth)", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });
      await addCourseMember(course.id, teacher.id, "teacher");
      const assignment = await makeAssignment(course.id, teacher.id);

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(null), resolved, "denied"),
      ).rejects.toThrow(/auth/i);
    });

    it("allows a course TA", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });
      await addCourseMember(course.id, teacher.id, "teacher");
      const ta = await createTestUser({ platformRole: "student" });
      await addCourseMember(course.id, ta.id, "ta");
      const assignment = await makeAssignment(course.id, teacher.id);

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(ta)), resolved, "denied"),
      ).resolves.toBeUndefined();
    });

    it("allows a platform admin", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });
      await addCourseMember(course.id, teacher.id, "teacher");
      const admin = await createTestUser({ platformRole: "admin" });
      const assignment = await makeAssignment(course.id, teacher.id);

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(admin)), resolved, "denied"),
      ).resolves.toBeUndefined();
    });

    it("allows the contest organizer for a contest target", async () => {
      const organizer = await createTestUser({ platformRole: "teacher" });
      const contest = await createTestContest({ createdByUserId: organizer.id });

      const resolved = await plagiarismDomain.getPlagiarismTarget(contest.id, "contest");
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(organizer)), resolved, "denied"),
      ).resolves.toBeUndefined();
    });

    it("rejects a non-organizer non-admin on a contest target", async () => {
      const organizer = await createTestUser({ platformRole: "teacher" });
      const contest = await createTestContest({ createdByUserId: organizer.id });
      const stranger = await createTestUser({ platformRole: "teacher" });

      const resolved = await plagiarismDomain.getPlagiarismTarget(contest.id, "contest");
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(stranger)), resolved, "denied"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("GET /api/plagiarism/[assignmentId]/sources gate", () => {
    // Same gate as trigger; cover the same actor matrix to pin the contract.
    it("rejects a same-course student with ForbiddenError", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });
      await addCourseMember(course.id, teacher.id, "teacher");
      const student = await createTestUser({ platformRole: "student" });
      await addCourseMember(course.id, student.id, "student");
      const assignment = await makeAssignment(course.id, teacher.id);

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(student)), resolved, "denied"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects a teacher of a different course", async () => {
      const ownerA = await createTestUser({ platformRole: "teacher" });
      const courseA = await createTestCourse({ ownerId: ownerA.id });
      await addCourseMember(courseA.id, ownerA.id, "teacher");
      const assignment = await makeAssignment(courseA.id, ownerA.id);

      const stranger = await createTestUser({ platformRole: "teacher" });

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(stranger)), resolved, "denied"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("allows a course TA", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });
      await addCourseMember(course.id, teacher.id, "teacher");
      const ta = await createTestUser({ platformRole: "student" });
      await addCourseMember(course.id, ta.id, "ta");
      const assignment = await makeAssignment(course.id, teacher.id);

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(ta)), resolved, "denied"),
      ).resolves.toBeUndefined();
    });

    it("allows a platform admin", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });
      await addCourseMember(course.id, teacher.id, "teacher");
      const admin = await createTestUser({ platformRole: "admin" });
      const assignment = await makeAssignment(course.id, teacher.id);

      const resolved = await plagiarismDomain.getPlagiarismTarget(assignment.id, null);
      await expect(
        assertCanManagePlagiarism(stubEvent(sessionFor(admin)), resolved, "denied"),
      ).resolves.toBeUndefined();
    });
  });

  describe("POST /api/plagiarism-flags gate (flagPair)", () => {
    it("rejects a same-course student with ForbiddenError", async () => {
      const { course, assignment, pairKey } = await setupFlagPair();
      const student = await createTestUser({ platformRole: "student" });
      await addCourseMember(course.id, student.id, "student");

      await expect(
        plagiarismDomain.flagPair(actorFor(student), {
          contextType: "assessment",
          contextId: assignment.id,
          pairKey,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects a teacher of a different course with ForbiddenError", async () => {
      const { assignment, pairKey } = await setupFlagPair();
      const stranger = await createTestUser({ platformRole: "teacher" });

      await expect(
        plagiarismDomain.flagPair(actorFor(stranger), {
          contextType: "assessment",
          contextId: assignment.id,
          pairKey,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("allows a course TA", async () => {
      const { course, assignment, pairKey } = await setupFlagPair();
      const ta = await createTestUser({ platformRole: "student" });
      await addCourseMember(course.id, ta.id, "ta");

      const flag = await plagiarismDomain.flagPair(actorFor(ta), {
        contextType: "assessment",
        contextId: assignment.id,
        pairKey,
      });
      expect(flag.flaggedBy).toBe(ta.id);
    });

    it("allows a platform admin", async () => {
      const { assignment, pairKey } = await setupFlagPair();
      const admin = await createTestUser({ platformRole: "admin" });

      const flag = await plagiarismDomain.flagPair(actorFor(admin), {
        contextType: "assessment",
        contextId: assignment.id,
        pairKey,
      });
      expect(flag.flaggedBy).toBe(admin.id);
    });

    it("allows the contest organizer on a contest context", async () => {
      const organizer = await createTestUser({ platformRole: "teacher" });
      const contest = await createTestContest({ createdByUserId: organizer.id });
      const problem = await createTestProblem({ authorId: organizer.id });
      const userA = await createTestUser({ platformRole: "student" });
      const userB = await createTestUser({ platformRole: "student" });
      const pairKey = plagiarismDomain.buildPairKey(userA.id, userB.id, problem.id);

      const flag = await plagiarismDomain.flagPair(actorFor(organizer), {
        contextType: "contest",
        contextId: contest.id,
        pairKey,
      });
      expect(flag.flaggedBy).toBe(organizer.id);
    });

    it("rejects a non-organizer teacher on a contest context", async () => {
      const organizer = await createTestUser({ platformRole: "teacher" });
      const contest = await createTestContest({ createdByUserId: organizer.id });
      const stranger = await createTestUser({ platformRole: "teacher" });
      const problem = await createTestProblem({ authorId: organizer.id });
      const userA = await createTestUser({ platformRole: "student" });
      const userB = await createTestUser({ platformRole: "student" });
      const pairKey = plagiarismDomain.buildPairKey(userA.id, userB.id, problem.id);

      await expect(
        plagiarismDomain.flagPair(actorFor(stranger), {
          contextType: "contest",
          contextId: contest.id,
          pairKey,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("DELETE /api/plagiarism-flags/[id] gate (unflagPair)", () => {
    it("rejects a same-course student with ForbiddenError", async () => {
      const { course, flag } = await setupFlag();
      const student = await createTestUser({ platformRole: "student" });
      await addCourseMember(course.id, student.id, "student");

      await expect(
        plagiarismDomain.unflagPair(actorFor(student), flag.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects a teacher of a different course with ForbiddenError", async () => {
      const { flag } = await setupFlag();
      const stranger = await createTestUser({ platformRole: "teacher" });

      await expect(
        plagiarismDomain.unflagPair(actorFor(stranger), flag.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("allows a course TA", async () => {
      const { course, flag } = await setupFlag();
      const ta = await createTestUser({ platformRole: "student" });
      await addCourseMember(course.id, ta.id, "ta");

      await expect(plagiarismDomain.unflagPair(actorFor(ta), flag.id)).resolves.toBeUndefined();
    });

    it("allows a platform admin", async () => {
      const { flag } = await setupFlag();
      const admin = await createTestUser({ platformRole: "admin" });

      await expect(
        plagiarismDomain.unflagPair(actorFor(admin), flag.id),
      ).resolves.toBeUndefined();
    });

    it("allows the contest organizer for a contest-context flag", async () => {
      const organizer = await createTestUser({ platformRole: "teacher" });
      const contest = await createTestContest({ createdByUserId: organizer.id });
      const problem = await createTestProblem({ authorId: organizer.id });
      const userA = await createTestUser({ platformRole: "student" });
      const userB = await createTestUser({ platformRole: "student" });
      const pairKey = plagiarismDomain.buildPairKey(userA.id, userB.id, problem.id);
      const flag = await plagiarismDomain.flagPair(actorFor(organizer), {
        contextType: "contest",
        contextId: contest.id,
        pairKey,
      });

      await expect(
        plagiarismDomain.unflagPair(actorFor(organizer), flag.id),
      ).resolves.toBeUndefined();
    });
  });
});
