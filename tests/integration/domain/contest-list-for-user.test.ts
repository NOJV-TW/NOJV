import { describe, expect, it } from "vitest";

import {
  createTestContest,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { contestDomain } from "@nojv/domain";

const { listContestsForUser } = contestDomain;

async function createCourseWithMember(
  role: "teacher" | "ta" | "student",
  userId: string,
  slug: string
) {
  const course = await testPrisma.course.create({
    data: {
      id: slug,
      slug,
      title: `Course ${slug}`,
      description: "",
      locale: "en",
      visibility: "listed",
      ownerId: userId
    }
  });
  await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId, role, status: "active" }
  });
  return course;
}

describe("listContestsForUser", () => {
  it("puts user-created standalone contests into managed, not participable", async () => {
    const user = await createTestUser();
    const mine = await createTestContest({
      createdByUserId: user.id,
      visibility: "published",
      title: "Mine"
    });
    await createTestContest({
      visibility: "published",
      title: "Public"
    });

    const result = await listContestsForUser(user.id, new Date());

    const managedIds = result.managed.map((c) => c.id);
    const participableIds = result.participable.map((c) => c.id);
    expect(managedIds).toContain(mine.id);
    expect(participableIds).not.toContain(mine.id);
    expect(participableIds).toHaveLength(1);
  });

  it("includes draft contests in managed for the owner", async () => {
    const user = await createTestUser();
    const draft = await createTestContest({
      createdByUserId: user.id,
      visibility: "draft",
      title: "Draft"
    });

    const result = await listContestsForUser(user.id, new Date());
    expect(result.managed.map((c) => c.id)).toContain(draft.id);
  });

  it("puts course-teacher contests into managed", async () => {
    const teacher = await createTestUser();
    const course = await createCourseWithMember("teacher", teacher.id, "course-t1");
    const contest = await createTestContest({
      visibility: "published",
      courseId: course.id
    });

    const result = await listContestsForUser(teacher.id, new Date());
    expect(result.managed.map((c) => c.id)).toContain(contest.id);
    expect(result.participable.map((c) => c.id)).not.toContain(contest.id);
  });

  it("puts course-TA contests into managed", async () => {
    const ta = await createTestUser();
    const course = await createCourseWithMember("ta", ta.id, "course-ta1");
    const contest = await createTestContest({
      visibility: "published",
      courseId: course.id
    });

    const result = await listContestsForUser(ta.id, new Date());
    expect(result.managed.map((c) => c.id)).toContain(contest.id);
  });

  it("puts course-student contests into participable", async () => {
    const student = await createTestUser();
    const course = await createCourseWithMember("student", student.id, "course-s1");
    const contest = await createTestContest({
      visibility: "published",
      courseId: course.id
    });

    const result = await listContestsForUser(student.id, new Date());
    expect(result.participable.map((c) => c.id)).toContain(contest.id);
    expect(result.managed.map((c) => c.id)).not.toContain(contest.id);
  });

  it("does not duplicate a contest that the user both created and teaches", async () => {
    const user = await createTestUser();
    const course = await createCourseWithMember("teacher", user.id, "course-dup");
    const contest = await createTestContest({
      createdByUserId: user.id,
      visibility: "published",
      courseId: course.id
    });

    const result = await listContestsForUser(user.id, new Date());
    const managedAppearances = result.managed.filter((c) => c.id === contest.id).length;
    expect(managedAppearances).toBe(1);
    expect(result.participable.map((c) => c.id)).not.toContain(contest.id);
  });

  it("returns only public standalone contests for unauthenticated callers", async () => {
    const owner = await createTestUser();
    const course = await createCourseWithMember("teacher", owner.id, "course-anon");
    const standalone = await createTestContest({ visibility: "published" });
    await createTestContest({ visibility: "published", courseId: course.id });

    const result = await listContestsForUser(null, new Date());
    expect(result.managed).toEqual([]);
    expect(result.participable.map((c) => c.id)).toContain(standalone.id);
  });
});
