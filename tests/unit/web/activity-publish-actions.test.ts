import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateAssignment: vi.fn(),
  publishAssignment: vi.fn(),
  revertAssignment: vi.fn(),
  updateExam: vi.fn(),
  publishExam: vi.fn(),
  updateContest: vi.fn(),
  publishContest: vi.fn(),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: () => Promise.resolve(null),
}));
vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
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
    assignmentDomain: {
      ...actual.assignmentDomain,
      updateAssignmentRecord: mocks.updateAssignment,
      publishAssignment: mocks.publishAssignment,
      revertAssignmentToDraft: mocks.revertAssignment,
    },
    examDomain: {
      ...actual.examDomain,
      updateExamRecord: mocks.updateExam,
      publishExam: mocks.publishExam,
    },
    contestDomain: {
      ...actual.contestDomain,
      updateContestRecord: mocks.updateContest,
      publishContest: mocks.publishContest,
    },
  };
});

import { actions as assignmentActions } from "../../../apps/web/src/routes/(app)/assignments/[assignmentId]/+page.server";
import { actions as examActions } from "../../../apps/web/src/routes/(app)/exams/[examId]/+page.server";
import { actions as contestActions } from "../../../apps/web/src/routes/(app)/contests/[contestId]/+page.server";

function event(testForm: Record<string, unknown>) {
  const url = new URL("http://localhost/activity?/publish");
  return {
    params: { assignmentId: "assignment_1", examId: "exam_1", contestId: "contest_1" },
    request: new Request(url, { method: "POST", body: new URLSearchParams() }),
    url,
    locals: { sessionUser: { id: "u1", username: "teacher", platformRole: "teacher" } },
    testForm,
  } as never;
}

const schedule = {
  startsAt: "2030-01-01T00:00",
  opensAt: "2030-01-01T00:00",
  dueAt: "2030-01-01T01:00",
  endsAt: "2030-01-01T02:00",
  closesAt: "2030-01-01T02:00",
};
const assignmentForm = { ...schedule, title: "Edited title", allowedLanguages: ["cpp"] };
const examForm = { ...schedule, title: "Edited exam", allowedLanguages: ["cpp"] };
const contestForm = {
  ...schedule,
  title: "Edited contest",
  summary: "Edited contest summary",
  problems: [{ problemId: "problem_1", points: 100 }],
};

function successForm(result: unknown) {
  return expect(result).toMatchObject({
    form: { valid: true, message: { kind: "success" } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("activity publish actions", () => {
  it("saves the submitted assignment settings before publishing and returns the form", async () => {
    successForm(await assignmentActions.publishAssignment(event(assignmentForm)));
    expect(mocks.updateAssignment).toHaveBeenCalledWith(
      expect.anything(),
      "assignment_1",
      expect.objectContaining({ title: "Edited title", allowedLanguages: ["cpp"] }),
    );
    expect(mocks.updateAssignment.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishAssignment.mock.invocationCallOrder[0]!,
    );
  });

  it("saves the submitted exam settings before publishing and returns the form", async () => {
    successForm(await examActions.publishExam(event(examForm)));
    expect(mocks.updateExam).toHaveBeenCalledWith(
      expect.anything(),
      "exam_1",
      expect.objectContaining({ title: "Edited exam", allowedLanguages: ["cpp"] }),
    );
    expect(mocks.updateExam.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishExam.mock.invocationCallOrder[0]!,
    );
  });

  it("saves the submitted contest settings before publishing and returns the form", async () => {
    successForm(await contestActions.publishContest(event(contestForm)));
    expect(mocks.updateContest).toHaveBeenCalledWith(
      expect.anything(),
      "contest_1",
      expect.objectContaining({ title: "Edited contest" }),
    );
    expect(mocks.updateContest.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishContest.mock.invocationCallOrder[0]!,
    );
  });

  it("does not publish when the save fails", async () => {
    mocks.updateAssignment.mockRejectedValueOnce(new Error("save failed"));
    const result = await assignmentActions.publishAssignment(event(assignmentForm));
    expect(result).toMatchObject({ data: { form: { message: { kind: "error" } } } });
    expect(mocks.publishAssignment).not.toHaveBeenCalled();
  });

  it("returns the form after reverting an assignment to draft", async () => {
    successForm(await assignmentActions.revertToDraft(event(assignmentForm)));
    expect(mocks.revertAssignment).toHaveBeenCalledWith(expect.anything(), "assignment_1");
  });
});
