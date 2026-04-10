import { describe, expect, it } from "vitest";

import {
  createTestCourse,
  createTestProblem,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { courseDomain } from "@nojv/domain";

const { listCourseCards, getCoursePageData, getDashboardStats, joinCourseRecord } =
  courseDomain;
import { ForbiddenError, type CompletedActorContext } from "$lib/server/auth";

function makeActor(user: {
  id: string;
  email: string;
  name: string;
  username: string | null;
  platformRole: string;
}): CompletedActorContext {
  return {
    displayName: user.name,
    email: user.email,
    username: user.username ?? user.id,
    platformRole: user.platformRole as "admin" | "teacher" | "student",
    userId: user.id
  };
}

describe("course queries (real DB)", () => {
  // --- listCourseCards ---

  describe("listCourseCards", () => {
    it("returns all courses when no userId filter", async () => {
      await createTestCourse({ title: "Course A" });
      await createTestCourse({ title: "Course B" });

      const cards = await listCourseCards();
      expect(cards).toHaveLength(2);
    });

    it("returns only courses the user is a member of when userId is provided", async () => {
      const student = await createTestUser();
      const course1 = await createTestCourse({ title: "Enrolled" });
      await createTestCourse({ title: "Not Enrolled" });

      await testPrisma.courseMembership.create({
        data: {
          courseId: course1.id,
          userId: student.id,
          role: "student",
          status: "active",
          joinedAt: new Date(),
          joinedTokenId: null
        }
      });

      const cards = await listCourseCards(student.id);
      expect(cards).toHaveLength(1);
      expect(cards[0]!.title).toBe("Enrolled");
    });

    it("excludes inactive memberships from count and filtering", async () => {
      const student = await createTestUser();
      const course = await createTestCourse();

      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: student.id,
          role: "student",
          status: "removed",
          joinedAt: new Date(),
          joinedTokenId: null
        }
      });

      const cards = await listCourseCards(student.id);
      expect(cards).toHaveLength(0);
    });

    it("returns correct member and assessment counts", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });

      // Active membership
      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: teacher.id,
          role: "teacher",
          status: "active",
          joinedAt: new Date(),
          joinedTokenId: null
        }
      });

      // Published assessment
      await testPrisma.courseAssessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "HW 1",
          slug: "hw-1",
          summary: "Test",
          opensAt: new Date(),
          dueAt: new Date(Date.now() + 86400000),
          closesAt: new Date(Date.now() + 86400000),
          status: "published"
        }
      });

      const cards = await listCourseCards();
      expect(cards).toHaveLength(1);
      expect(cards[0]!.memberCount).toBe(1);
      expect(cards[0]!.assessmentCount).toBe(1);
    });
  });

  // --- getCoursePageData ---

  describe("getCoursePageData", () => {
    it("returns null for nonexistent slug", async () => {
      const result = await getCoursePageData("nonexistent");
      expect(result).toBeNull();
    });

    it("returns course detail with members and problems", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({
        slug: "cs101",
        title: "CS 101",
        ownerId: teacher.id
      });

      // Add teacher membership
      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: teacher.id,
          role: "teacher",
          status: "active",
          joinedAt: new Date(),
          joinedTokenId: null
        }
      });

      // Add a problem to the course
      const problem = await createTestProblem({ authorId: teacher.id });
      await testPrisma.courseProblem.create({
        data: {
          courseId: course.id,
          problemId: problem.id,
          addedByUserId: teacher.id
        }
      });

      const data = await getCoursePageData("cs101");
      expect(data).not.toBeNull();
      expect(data!.course.title).toBe("CS 101");
      expect(data!.course.slug).toBe("cs101");
      expect(data!.course.members).toHaveLength(1);
      expect(data!.course.members[0]!.courseRole).toBe("teacher");
      expect(data!.problems).toHaveLength(1);
      expect(data!.problems[0]!.slug).toBe(problem.slug);
    });

    it("returns join channels from join tokens", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({
        slug: "join-test",
        ownerId: teacher.id
      });

      await testPrisma.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          label: "Code",
          kind: "code",
          token: "ABC123"
        }
      });

      const data = await getCoursePageData("join-test");
      expect(data).not.toBeNull();
      expect(data!.course.joinChannels).toHaveLength(1);
      expect(data!.course.joinChannels[0]!.token).toBe("ABC123");
      expect(data!.course.joinChannels[0]!.kind).toBe("code");
    });
  });

  // --- getDashboardStats ---

  describe("getDashboardStats", () => {
    it("returns correct counts of public problems and courses", async () => {
      await createTestProblem({ visibility: "public" });
      await createTestProblem({ visibility: "public" });
      await createTestProblem({ visibility: "private" });
      await createTestCourse();

      const stats = await getDashboardStats();
      expect(stats.problems).toBe(2);
      expect(stats.courses).toBe(1);
    });

    it("returns zeros when DB is empty", async () => {
      const stats = await getDashboardStats();
      expect(stats.problems).toBe(0);
      expect(stats.courses).toBe(0);
    });
  });

  // --- joinCourseRecord ---

  describe("joinCourseRecord", () => {
    it("allows a user to join with a valid join code", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const student = await createTestUser({ platformRole: "student" });
      const course = await createTestCourse({
        slug: "join-course",
        ownerId: teacher.id
      });

      await testPrisma.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          label: "Code",
          kind: "code",
          token: "JOINME"
        }
      });

      const actor = makeActor(student);
      const membership = await joinCourseRecord(actor, {
        courseSlug: "join-course",
        joinTokenKind: "code",
        joinToken: "JOINME"
      });

      expect(membership.userId).toBe(student.id);
      expect(membership.role).toBe("student");
      expect(membership.status).toBe("active");
    });

    it("rejects join with invalid token", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const student = await createTestUser({ platformRole: "student" });
      await createTestCourse({ slug: "reject-join", ownerId: teacher.id });

      const actor = makeActor(student);

      await expect(
        joinCourseRecord(actor, {
          courseSlug: "reject-join",
          joinTokenKind: "code",
          joinToken: "WRONG"
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects join with expired token", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const student = await createTestUser({ platformRole: "student" });
      const course = await createTestCourse({
        slug: "expired-join",
        ownerId: teacher.id
      });

      await testPrisma.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          label: "Expired",
          kind: "code",
          token: "EXPIRED",
          expiresAt: new Date("2020-01-01")
        }
      });

      const actor = makeActor(student);
      await expect(
        joinCourseRecord(actor, {
          courseSlug: "expired-join",
          joinTokenKind: "code",
          joinToken: "EXPIRED"
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("returns existing membership if user is already active", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const student = await createTestUser({ platformRole: "student" });
      const course = await createTestCourse({
        slug: "already-member",
        ownerId: teacher.id
      });

      await testPrisma.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          label: "Code",
          kind: "code",
          token: "DOUBLE"
        }
      });

      // Pre-create active membership
      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: student.id,
          role: "student",
          status: "active",
          joinedAt: new Date(),
          joinedTokenId: null
        }
      });

      const actor = makeActor(student);
      const membership = await joinCourseRecord(actor, {
        courseSlug: "already-member",
        joinTokenKind: "code",
        joinToken: "DOUBLE"
      });

      expect(membership.status).toBe("active");

      // Should still be exactly 1 membership
      const count = await testPrisma.courseMembership.count({
        where: { courseId: course.id, userId: student.id }
      });
      expect(count).toBe(1);
    });

    it("increments usage count on join token after successful join", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const student = await createTestUser({ platformRole: "student" });
      const course = await createTestCourse({
        slug: "usage-count",
        ownerId: teacher.id
      });

      const token = await testPrisma.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          label: "Code",
          kind: "code",
          token: "COUNT"
        }
      });

      expect(token.usageCount).toBe(0);

      const actor = makeActor(student);
      await joinCourseRecord(actor, {
        courseSlug: "usage-count",
        joinTokenKind: "code",
        joinToken: "COUNT"
      });

      const updated = await testPrisma.courseJoinToken.findUnique({
        where: { id: token.id }
      });
      expect(updated!.usageCount).toBe(1);
    });
  });
});
