import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExam: vi.fn(),
  updateExam: vi.fn(),
  updateAssignment: vi.fn(),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: async () => null,
}));
vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock("$lib/server/auth", async (original) => ({
  ...(await original<typeof import("$lib/server/auth")>()),
  getCoursePermissionRole: async () => "teacher",
}));
vi.mock("sveltekit-superforms", async () => {
  const actual = await import("sveltekit-superforms/server");
  return {
    ...actual,
    superValidate: (input: unknown, ...args: unknown[]) =>
      Reflect.apply(actual.superValidate, undefined, [
        input && typeof input === "object" && "testForm" in input ? input.testForm : input,
        ...args,
      ]),
  };
});
vi.mock("@nojv/application", async (original) => {
  const actual = await original<typeof import("@nojv/application")>();
  return {
    ...actual,
    examDomain: {
      ...actual.examDomain,
      createExamRecord: mocks.createExam,
      updateExamRecord: mocks.updateExam,
    },
    assignmentDomain: {
      ...actual.assignmentDomain,
      updateAssignmentRecord: mocks.updateAssignment,
    },
  };
});

import { actions as examCreate } from "../../../apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.server";
import { actions as examSettings } from "../../../apps/web/src/routes/(app)/exams/[examId]/+page.server";
import { actions as assignmentSettings } from "../../../apps/web/src/routes/(app)/assignments/[assignmentId]/+page.server";

const dueAt = "2030-01-01T01:00";
const finalAt = "2030-01-01T02:00";
const rule = { type: "daily_late_penalty", perDayPct: 10 } as const;
function event(allowLateSubmissions: boolean, final = finalAt) {
  const url = new URL("http://localhost/courses/course_1?/updateSettings");
  return {
    params: { courseId: "course_1", examId: "exam_1", assignmentId: "assignment_1" },
    request: new Request(url, { method: "POST", body: new URLSearchParams() }),
    url,
    locals: { sessionUser: { id: "u1", username: "teacher", platformRole: "teacher" } },
    testForm: {
      courseId: "course_1",
      title: "Assessment",
      startsAt: "2030-01-01T00:00",
      opensAt: "2030-01-01T00:00",
      dueAt,
      endsAt: final,
      closesAt: final,
      allowLateSubmissions,
      latePenalty: rule,
    },
  } as never;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createExam.mockResolvedValue({ id: "exam_1" });
});

describe("late submission form actions", () => {
  it.each([false, true])("maps exam create with late submissions %s", async (allowed) => {
    await expect(
      examCreate.saveDraft(event(allowed, allowed ? finalAt : "")),
    ).rejects.toMatchObject({ status: 303 });
    expect(mocks.createExam).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dueAt: new Date(dueAt).toISOString(),
        endsAt: new Date(allowed ? finalAt : dueAt).toISOString(),
        adjustmentRules: allowed ? [rule] : [],
      }),
    );
  });

  it.each([false, true])(
    "maps assignment and exam settings with late submissions %s",
    async (allowed) => {
      await examSettings.updateSettings(event(allowed, allowed ? finalAt : ""));
      await assignmentSettings.updateSettings(event(allowed, allowed ? finalAt : ""));
      const expected = {
        dueAt: new Date(dueAt).toISOString(),
        adjustmentRules: allowed ? [rule] : [],
      };
      expect(mocks.updateExam).toHaveBeenCalledWith(
        expect.anything(),
        "exam_1",
        expect.objectContaining({
          ...expected,
          endsAt: new Date(allowed ? finalAt : dueAt).toISOString(),
        }),
      );
      expect(mocks.updateAssignment).toHaveBeenCalledWith(
        expect.anything(),
        "assignment_1",
        expect.objectContaining({
          dueAt: new Date(dueAt).toISOString(),
          latePenalty: allowed ? rule : null,
          closesAt: new Date(allowed ? finalAt : dueAt).toISOString(),
        }),
      );
      expect(mocks.updateAssignment.mock.calls[0]?.[2]).not.toHaveProperty("adjustmentRules");
    },
  );

  it("rejects missing final collection when late submissions are enabled", async () => {
    for (const action of [
      examCreate.saveDraft,
      examSettings.updateSettings,
      assignmentSettings.updateSettings,
    ]) {
      expect(await action(event(true, ""))).toMatchObject({
        status: 400,
        data: { form: { valid: false } },
      });
    }
    expect(mocks.createExam).not.toHaveBeenCalled();
    expect(mocks.updateExam).not.toHaveBeenCalled();
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
  });
});
