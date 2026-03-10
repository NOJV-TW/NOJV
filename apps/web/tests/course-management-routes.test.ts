import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../src/lib/server/api-errors";

const attachProblemToCourseRecord = vi.fn();
const createCourseAssessmentRecord = vi.fn();
const joinCourseRecord = vi.fn();
const manuallyEnrollCourseMember = vi.fn();

interface MockActor {
  displayName: string;
  email: string;
  handle: string;
  platformRole: "admin" | "student" | "teacher";
  userId: string;
}

let currentActor: MockActor = {
  displayName: "Teacher Amelia",
  email: "amelia@nojv.local",
  handle: "teacher_amelia",
  platformRole: "teacher",
  userId: "usr_teacher_amelia"
};

let currentPermissionRole: "admin" | "student" | "ta" | "teacher" | undefined = "teacher";

vi.mock("@/lib/server/actor-context", () => ({
  getActorContext: vi.fn(() => currentActor)
}));

vi.mock("@/lib/server/authorization", () => ({
  canManageCourseMembership: vi.fn(
    (role: "admin" | "student" | "ta" | "teacher" | undefined) => {
      return role === "admin" || role === "teacher" || role === "ta";
    }
  ),
  canPublishAssessment: vi.fn((role: "admin" | "student" | "ta" | "teacher" | undefined) => {
    return role === "admin" || role === "teacher" || role === "ta";
  }),
  getCoursePermissionRole: vi.fn(() => currentPermissionRole)
}));

vi.mock("@/lib/server/data-access/courses", () => ({
  attachProblemToCourseRecord,
  createCourseAssessmentRecord,
  joinCourseRecord,
  manuallyEnrollCourseMember
}));

describe("course management routes", () => {
  beforeEach(() => {
    currentActor = {
      displayName: "Teacher Amelia",
      email: "amelia@nojv.local",
      handle: "teacher_amelia",
      platformRole: "teacher",
      userId: "usr_teacher_amelia"
    };
    currentPermissionRole = "teacher";
    vi.clearAllMocks();
  });

  it("maps exhausted join tokens to a forbidden response", async () => {
    currentActor = {
      displayName: "Student Bob",
      email: "bob@nojv.local",
      handle: "stu_bob",
      platformRole: "student",
      userId: "usr_student_bob"
    };
    joinCourseRecord.mockRejectedValue(
      new ForbiddenError("Course join token has reached its maximum usage.")
    );

    const { POST } = await import("../src/app/api/courses/[slug]/join/route");
    const response = await POST(
      new Request("http://localhost/api/courses/os-lab-spring-2026/join", {
        body: JSON.stringify({
          joinMethod: "join_code",
          joinToken: "OSLAB2026"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }),
      {
        params: Promise.resolve({
          slug: "os-lab-spring-2026"
        })
      }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Course join token has reached its maximum usage."
    });
  });

  it("blocks students from publishing course assessments", async () => {
    currentPermissionRole = "student";

    const { POST } = await import("../src/app/api/courses/[slug]/assessments/route");
    const response = await POST(
      new Request("http://localhost/api/courses/os-lab-spring-2026/assessments", {
        body: JSON.stringify({
          closesAt: "2026-03-25T15:00:00.000Z",
          dueAt: "2026-03-23T15:00:00.000Z",
          opensAt: "2026-03-17T09:00:00.000Z",
          problemSlugs: ["warmup-sum"],
          slug: "hw1-process-warmup",
          summary: "First homework window.",
          title: "Homework 1",
          type: "assignment"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }),
      {
        params: Promise.resolve({
          slug: "os-lab-spring-2026"
        })
      }
    );

    expect(response.status).toBe(403);
    expect(createCourseAssessmentRecord).not.toHaveBeenCalled();
  });

  it("maps private problem permission failures to forbidden", async () => {
    attachProblemToCourseRecord.mockRejectedValue(
      new ForbiddenError("Private problems can only be attached by their author or an admin.")
    );

    const { POST } = await import("../src/app/api/courses/[slug]/problems/route");
    const response = await POST(
      new Request("http://localhost/api/courses/os-lab-spring-2026/problems", {
        body: JSON.stringify({
          problemSlug: "private-compiler-checkpoint"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }),
      {
        params: Promise.resolve({
          slug: "os-lab-spring-2026"
        })
      }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Private problems can only be attached by their author or an admin."
    });
  });

  it("blocks students from manually enrolling course members", async () => {
    currentPermissionRole = "student";

    const { POST } = await import("../src/app/api/courses/[slug]/members/route");
    const response = await POST(
      new Request("http://localhost/api/courses/os-lab-spring-2026/members", {
        body: JSON.stringify({
          displayName: "Carol Tsai",
          email: "carol@nojv.local",
          handle: "stu_carol",
          role: "student"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }),
      {
        params: Promise.resolve({
          slug: "os-lab-spring-2026"
        })
      }
    );

    expect(response.status).toBe(403);
    expect(manuallyEnrollCourseMember).not.toHaveBeenCalled();
  });
});
