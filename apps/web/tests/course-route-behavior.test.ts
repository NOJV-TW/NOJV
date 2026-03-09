import { beforeEach, describe, expect, it, vi } from "vitest";

const listCourseCards = vi.fn();
const getActorContext = vi.fn();

vi.mock("@/lib/server/actor-context", () => ({
  getActorContext
}));

vi.mock("@/lib/server/course-authorization", () => ({
  canCreateCourse: vi.fn()
}));

vi.mock("@/lib/server/poc-persistence", () => ({
  createCourseRecord: vi.fn()
}));

vi.mock("@/lib/server/read-model", () => ({
  listCourseCards
}));

describe("course routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns persisted course cards from GET /api/courses", async () => {
    getActorContext.mockResolvedValue({
      displayName: "Teacher",
      email: "teacher@nojv.local",
      handle: "teacher",
      platformRole: "teacher",
      userId: "usr_teacher"
    });
    listCourseCards.mockResolvedValue([
      {
        assessmentCount: 1,
        memberCount: 3,
        slug: "compiler-design-2026",
        title: "Compiler Design"
      }
    ]);

    const { GET } = await import("../src/app/api/courses/route");
    const response = await GET(new Request("http://localhost/api/courses"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      courses: [
        {
          assessmentCount: 1,
          memberCount: 3,
          slug: "compiler-design-2026",
          title: "Compiler Design"
        }
      ]
    });
  });
});
