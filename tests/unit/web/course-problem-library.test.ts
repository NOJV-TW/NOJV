import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, ValidationError } from "@nojv/application";
import type * as Application from "@nojv/application";

const mocks = vi.hoisted(() => ({
  header: vi.fn(),
  library: vi.fn(),
  editable: vi.fn(),
  picker: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  updateAssignment: vi.fn(),
  updateExam: vi.fn(),
}));
vi.mock("sveltekit-superforms", () => import("sveltekit-superforms/server"));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: () => Promise.resolve(null),
}));
vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock("@nojv/application", async (original) => {
  const actual = await original<typeof Application>();
  return {
    ...actual,
    assignmentDomain: {
      ...actual.assignmentDomain,
      updateAssignmentRecord: mocks.updateAssignment,
    },
    examDomain: {
      ...actual.examDomain,
      updateExamRecord: mocks.updateExam,
    },
    courseDomain: {
      ...actual.courseDomain,
      getCourseHeaderById: mocks.header,
      getCourseProblemLibrary: mocks.library,
      addCourseProblems: mocks.add,
      removeCourseProblem: mocks.remove,
    },
    problemDomain: {
      ...actual.problemDomain,
      listEditableProblems: mocks.editable,
      listProblemPickerGroups: mocks.picker,
    },
  };
});

import { load as layoutLoad } from "$lib/../routes/(app)/courses/[courseId]/+layout.server";
import { actions, load } from "$lib/../routes/(app)/courses/[courseId]/problems/+page.server";
import { actions as assignmentActions } from "$lib/../routes/(app)/assignments/[assignmentId]/+page.server";
import { actions as examActions } from "$lib/../routes/(app)/exams/[examId]/+page.server";

function event(fields: Record<string, string | string[]> = {}, platformRole = "student") {
  const url = new URL("http://localhost/courses/course_1/problems");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) body.append(key, entry);
  }
  return {
    params: { courseId: "course_1", assignmentId: "assignment_1", examId: "exam_1" },
    request: new Request(url, { method: "POST", body }),
    url,
    locals: {
      sessionUser: { id: "u1", username: "ta", platformRole },
      adminAccessActive: platformRole === "admin",
    },
  } as never;
}

const courseHeader = {
  id: "course_1",
  title: "Course",
  ownerId: "owner",
  owner: { name: "Owner" },
  archived: false,
  memberships: [{ userId: "u1", role: "ta", status: "active" }],
  _count: { memberships: 1, assessments: 0, exams: 0 },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.header.mockResolvedValue(courseHeader);
  mocks.library.mockResolvedValue({
    course: { id: "course_1", title: "Course", archived: false },
    problems: [],
  });
  mocks.editable.mockResolvedValue([
    { id: "draft", visibility: "private", status: "draft" },
    { id: "private", visibility: "private", status: "published" },
    { id: "public", visibility: "public", status: "published" },
  ]);
  mocks.picker.mockResolvedValue({ personalProblems: [], publicProblems: [{ id: "public" }] });
});

describe("course library server authorization", () => {
  it("recognizes an active bound TA with a student platform role", async () => {
    await expect(layoutLoad(event())).resolves.toMatchObject({ isManager: true });
    await expect(load(event())).resolves.toMatchObject({ library: { problems: [] } });
    expect(mocks.library).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", platformRole: "student" }),
      "course_1",
    );
  });

  it.each([
    { role: "student", userId: "u1", status: "active" },
    { role: "ta", userId: null, pendingUsername: "ta", status: "active" },
    { role: "teacher", userId: "u1", status: "removed" },
  ])("does not grant management from $role / $status / $userId", async (membership) => {
    mocks.header.mockResolvedValue({
      ...courseHeader,
      ownerId: "u1",
      memberships: [membership],
    });
    if (membership.role === "student") {
      await expect(layoutLoad(event())).resolves.toMatchObject({ isManager: false });
    } else {
      await expect(layoutLoad(event())).rejects.toMatchObject({ status: 403 });
    }
    mocks.library.mockRejectedValue(new ForbiddenError("Not a course manager."));
    await expect(load(event())).rejects.toMatchObject({ status: 403 });
    expect(mocks.editable).not.toHaveBeenCalled();
    expect(mocks.picker).not.toHaveBeenCalled();
  });

  it("allows effective admin access without a membership", async () => {
    mocks.header.mockResolvedValue({ ...courseHeader, memberships: [] });
    await expect(layoutLoad(event({}, "admin"))).resolves.toMatchObject({ isManager: true });
  });

  it("offers own private drafts for library sharing and public imports separately", async () => {
    await expect(load(event())).resolves.toMatchObject({
      candidateProblems: {
        personalProblems: [{ id: "draft" }, { id: "private" }],
        publicProblems: [{ id: "public" }],
      },
    });
    expect(mocks.editable).toHaveBeenCalledWith("u1");
  });

  it("loads the archived library without querying add candidates", async () => {
    mocks.library.mockResolvedValue({ course: { archived: true }, problems: [] });
    await expect(load(event())).resolves.toMatchObject({
      candidateProblems: { personalProblems: [], publicProblems: [] },
    });
    expect(mocks.editable).not.toHaveBeenCalled();
    expect(mocks.picker).not.toHaveBeenCalled();
  });
});

describe("course library native form actions", () => {
  it("takes the actor and course from the server and validates selected IDs", async () => {
    await expect(
      actions.add(
        event({
          problemIds: ["draft", "public"],
          courseId: "forged",
          userId: "forged",
          existingProblemIds: "forged",
        }),
      ),
    ).resolves.toEqual({ added: true });
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
      "course_1",
      ["draft", "public"],
    );
    await expect(actions.remove(event({ problemId: "draft" }))).resolves.toEqual({
      removed: true,
    });
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
      "course_1",
      "draft",
    );
  });

  it.each([{}, { problemIds: " " }, { problemIds: Array(101).fill("p") }])(
    "rejects invalid add input without writing",
    async (fields) => {
      await expect(actions.add(event(fields))).resolves.toMatchObject({ status: 400 });
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );

  it("rejects missing remove IDs without writing", async () => {
    await expect(actions.remove(event())).resolves.toMatchObject({ status: 400 });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([
    [new ForbiddenError("Membership removed."), 403],
    [new ValidationError("Archived courses are read-only."), 400],
  ])("surfaces fresh backend authorization and archive failures", async (error, status) => {
    mocks.add.mockRejectedValue(error);
    mocks.remove.mockRejectedValue(error);
    await expect(actions.add(event({ problemIds: "p" }))).resolves.toMatchObject({ status });
    await expect(actions.remove(event({ problemId: "p" }))).resolves.toMatchObject({ status });
  });
});

describe.each([
  ["assignment", assignmentActions.updateProblems, mocks.updateAssignment, "assignment_1"],
  ["exam", examActions.updateProblems, mocks.updateExam, "exam_1"],
] as const)("%s course library grading action", (_kind, updateProblems, update, activityId) => {
  const payload = {
    problems: [
      { problemId: "historical-draft", points: 80 },
      { problemId: "shared-private", points: 120 },
    ],
    totalPoints: 200,
    gradingRevision: 3,
  };

  it("passes ordered allocations and revision with the authenticated actor", async () => {
    await expect(
      updateProblems(
        event({
          payload: JSON.stringify(payload),
          courseId: "forged",
          userId: "forged",
          existingProblemIds: "forged",
        }),
      ),
    ).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ userId: "u1", platformRole: "student" }),
      activityId,
      payload,
    );
  });

  it("rejects missing grading revisions before invoking the domain", async () => {
    await expect(
      updateProblems(
        event({
          payload: JSON.stringify({ problems: payload.problems, totalPoints: 200 }),
        }),
      ),
    ).resolves.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});
