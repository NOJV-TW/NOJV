import { describe, expect, it } from "vitest";

import {
  createTestCourse,
  createTestProblem,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { courseDomain } from "@nojv/domain";

const { listCourseCards, listForUserWithCards, getDashboardStats } = courseDomain;

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

  // --- listForUserWithCards ---

  describe("listForUserWithCards", () => {
    it("splits memberships into enrolled (student) and managing (teacher/ta)", async () => {
      const user = await createTestUser();

      const studentCourse = await createTestCourse({ title: "As Student" });
      const teacherCourse = await createTestCourse({ title: "As Teacher" });
      const taCourse = await createTestCourse({ title: "As TA" });

      await testPrisma.courseMembership.createMany({
        data: [
          { courseId: studentCourse.id, userId: user.id, role: "student", status: "active" },
          { courseId: teacherCourse.id, userId: user.id, role: "teacher", status: "active" },
          { courseId: taCourse.id, userId: user.id, role: "ta", status: "active" }
        ]
      });

      const { enrolled, managing } = await listForUserWithCards(user.id);

      expect(enrolled).toHaveLength(1);
      expect(enrolled[0]!.title).toBe("As Student");
      expect(enrolled[0]!.role).toBe("student");

      expect(managing).toHaveLength(2);
      const managingTitles = managing.map((c) => c.title).sort();
      expect(managingTitles).toEqual(["As TA", "As Teacher"]);
    });

    it("ignores removed memberships", async () => {
      const user = await createTestUser();
      const course = await createTestCourse();
      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: user.id,
          role: "student",
          status: "removed"
        }
      });

      const { enrolled, managing } = await listForUserWithCards(user.id);
      expect(enrolled).toHaveLength(0);
      expect(managing).toHaveLength(0);
    });

    it("returns empty arrays for a user with no memberships", async () => {
      const user = await createTestUser();
      const { enrolled, managing } = await listForUserWithCards(user.id);
      expect(enrolled).toEqual([]);
      expect(managing).toEqual([]);
    });

    it("computes batched status counters per course", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse({ ownerId: teacher.id });

      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: teacher.id,
          role: "teacher",
          status: "active"
        }
      });

      const now = Date.now();

      // Open assignment: opensAt <= now <= closesAt.
      await testPrisma.courseAssessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Open HW",
          slug: "hw-open",
          summary: "open",
          status: "published",
          opensAt: new Date(now - 60_000),
          dueAt: new Date(now + 86_400_000),
          closesAt: new Date(now + 86_400_000)
        }
      });

      // Draft assignment.
      await testPrisma.courseAssessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Draft HW",
          slug: "hw-draft",
          summary: "draft",
          status: "draft",
          opensAt: new Date(now),
          closesAt: new Date(now + 86_400_000)
        }
      });

      // Upcoming exam.
      await testPrisma.exam.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Midterm",
          summary: "upcoming exam",
          status: "published",
          startsAt: new Date(now + 3_600_000),
          endsAt: new Date(now + 3_600_000 * 2)
        }
      });

      const { managing } = await listForUserWithCards(teacher.id);
      expect(managing).toHaveLength(1);
      const card = managing[0]!;
      expect(card.role).toBe("teacher");
      expect(card.ownerDisplayName).toBe(teacher.name);
      expect(card.openAssignments).toBe(1);
      expect(card.draftAssignments).toBe(1);
      expect(card.upcomingExams).toBe(1);
      expect(card.assignmentCount).toBe(1); // only `published`
      expect(card.examCount).toBe(1);
    });

    it("student cards mirror open work into myDueCount and myUpcomingCount", async () => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const student = await createTestUser();
      const course = await createTestCourse({ ownerId: teacher.id });

      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: student.id,
          role: "student",
          status: "active"
        }
      });

      const now = Date.now();
      await testPrisma.courseAssessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "HW 1",
          slug: "hw-1",
          summary: "open",
          status: "published",
          opensAt: new Date(now - 60_000),
          closesAt: new Date(now + 86_400_000)
        }
      });

      const { enrolled } = await listForUserWithCards(student.id);
      expect(enrolled).toHaveLength(1);
      const card = enrolled[0]!;
      expect(card.role).toBe("student");
      expect(card.myDueCount).toBe(1);
      expect(card.myUpcomingCount).toBe(0);
      expect(card.myAllCaughtUp).toBe(false);
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
