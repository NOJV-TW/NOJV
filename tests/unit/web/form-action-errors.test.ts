import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  bulkAdd: vi.fn(),
  createExam: vi.fn(),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: async () => null,
}));
vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock("sveltekit-superforms", () => import("sveltekit-superforms/server"));
vi.mock("$lib/server/auth", async (original) => ({
  ...(await original<typeof import("$lib/server/auth")>()),
  getCoursePermissionRole: mocks.permission,
}));
vi.mock("@nojv/application", async (original) => {
  const actual = await original<typeof import("@nojv/application")>();
  return {
    ...actual,
    courseDomain: { ...actual.courseDomain, bulkAddByHandle: mocks.bulkAdd },
    examDomain: { ...actual.examDomain, createExamRecord: mocks.createExam },
  };
});

import { actions as members } from "../../../apps/web/src/routes/(app)/courses/[courseId]/members/+page.server";
import { actions as exams } from "../../../apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.server";

beforeEach(() => vi.resetAllMocks());

it.each([
  ["bulkAdd", members.bulkAdd, { handles: "student", role: "student" }],
  [
    "saveDraft",
    exams.saveDraft,
    {
      courseId: "course_1",
      title: "Exam",
      startsAt: "2030-01-01T00:00",
      endsAt: "2030-01-01T01:00",
    },
  ],
  [
    "publish",
    exams.publish,
    {
      courseId: "course_1",
      title: "Exam",
      startsAt: "2030-01-01T00:00",
      endsAt: "2030-01-01T01:00",
    },
  ],
] as const)(
  "%s returns a Superforms error without writing when authorization fails",
  async (actionName, action, fields) => {
    for (const unavailable of [false, true]) {
      mocks.permission.mockReset();
      if (unavailable)
        mocks.permission.mockRejectedValue(new Error("private database failure"));
      else mocks.permission.mockResolvedValue("student");
      const url = new URL(`http://localhost/courses/course_1?/${actionName}`);
      const result = await action({
        params: { courseId: "course_1" },
        request: new Request(url, { method: "POST", body: new URLSearchParams(fields) }),
        url,
        locals: { sessionUser: { id: "u1", username: "student", platformRole: "student" } },
      } as never);
      expect(result).toMatchObject({
        status: unavailable ? 500 : 403,
        data: {
          form: {
            valid: false,
            message: {
              kind: "error",
              text: unavailable ? "Internal server error." : "Forbidden",
            },
          },
        },
      });
    }
    expect(mocks.bulkAdd).not.toHaveBeenCalled();
    expect(mocks.createExam).not.toHaveBeenCalled();
  },
);
