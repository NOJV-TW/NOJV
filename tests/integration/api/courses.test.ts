import { describe, expect, it } from "vitest";

import {
  createTestCourse,
  createTestProblem,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { courseDomain } from "@nojv/domain";

const { listCourseCards, getDashboardStats } = courseDomain;

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
          joinedAt: new Date()
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
          joinedAt: new Date()
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
          joinedAt: new Date()
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
});
