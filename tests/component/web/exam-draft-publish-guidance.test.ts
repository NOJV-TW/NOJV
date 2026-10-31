// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { page } from "$app/state";
import { describe, expect, it, vi } from "vitest";
import { groupExamRows } from "#lib/components/features/course/exam/exam-list-groups.js";
import { m } from "#lib/paraglide/messages.js";
import CourseExamsPage from "../../../apps/web/src/routes/(app)/courses/[courseId]/exams/+page.svelte";
import ExamPage from "../../../apps/web/src/routes/(app)/exams/[examId]/+page.svelte";

vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$app/navigation", () => ({
  beforeNavigate: () => {},
  goto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return {
    CalendarCheck2: Empty,
    CalendarClock: Empty,
    ChevronRight: Empty,
    Monitor: Empty,
    Pencil: Empty,
    X: Empty,
  };
});

const rows = [
  {
    id: "draft",
    status: "draft" as const,
    title: "Draft exam",
  },
  {
    id: "upcoming",
    status: "upcoming" as const,
    title: "Published upcoming exam",
  },
];

describe("exam list groups", () => {
  it("keeps drafts in their own group instead of upcoming", () => {
    const groups = groupExamRows(rows);

    expect(groups.map((group) => group.key)).toEqual(["draft", "upcoming"]);
    expect(groups[0]?.items.map((exam) => exam.id)).toEqual(["draft"]);
    expect(groups[1]?.items.map((exam) => exam.id)).toEqual(["upcoming"]);
  });
});

const managerDraftData = {
  detail: {
    id: "exam_draft",
    title: "Draft exam",
    summary: null,
    status: "draft",
    startsAt: "2030-01-01T10:00:00.000Z",
    endsAt: "2030-01-01T12:00:00.000Z",
    dueAt: null,
    latePenalty: null,
    totalPoints: 100,
    viewerScore: null,
    gradingPending: false,
    gradingRevision: 0,
    pageLockEnabled: false,
    ipBindingEnabled: false,
    ipViolationMode: "notify",
    ipWhitelistEnabled: false,
    ipWhitelistCount: 0,
    submitIntervalSec: 0,
    manager: { allowedLanguages: ["cpp17"] },
    problems: [],
  },
  course: { archived: false },
  isManager: true,
  hasActiveSession: false,
  hasSubmitted: false,
  submittedProblemIds: [],
  feedback: [],
  matrix: null,
  canSetOverride: false,
  clarification: { canView: false, canAsk: false, canAnswer: false },
  candidateProblems: { personalProblems: [], publicProblems: [] },
  settingsForm: null,
};

it("shows draft publish guidance to managers and uses the draft status", async () => {
  page.url = new URL("http://localhost/exams/exam_draft");
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(ExamPage, {
    target,
    props: { data: managerDraftData as never, form: null },
  });
  await tick();

  expect(target.textContent).toContain(m.statusPill_exam_draft());
  expect(target.textContent).toContain(m.examDetail_draftPublishTitle());
  expect(target.textContent).toContain(m.examDetail_draftPublishDescription());
  expect(target.textContent).toContain(m.examDetail_clockDraftValue());
  expect(target.querySelector(".text-title.font-bold")).toBeNull();
  expect(
    target.querySelector('a[href="/exams/exam_draft?tab=settings"]')?.textContent,
  ).toContain(m.examDetail_draftPublishAction());

  await unmount(component);
  target.remove();
});

it("keeps publish guidance hidden from non-managers", async () => {
  page.url = new URL("http://localhost/exams/exam_draft");
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(ExamPage, {
    target,
    props: {
      data: { ...managerDraftData, isManager: false } as never,
      form: null,
    },
  });
  await tick();

  expect(target.textContent).not.toContain(m.examDetail_draftPublishTitle());

  await unmount(component);
  target.remove();
});

it("does not offer a publish action for drafts in archived courses", async () => {
  page.url = new URL("http://localhost/exams/exam_draft");
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(ExamPage, {
    target,
    props: {
      data: { ...managerDraftData, course: { archived: true } } as never,
      form: null,
    },
  });
  await tick();

  expect(target.textContent).toContain(m.examDetail_draftPublishTitle());
  expect(target.textContent).toContain(m.course_archivedReadOnly());
  expect(target.querySelector('a[href="/exams/exam_draft?tab=settings"]')).toBeNull();

  await unmount(component);
  target.remove();
});

it("keeps a published future exam in the scheduled state", async () => {
  page.url = new URL("http://localhost/exams/exam_upcoming");
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(ExamPage, {
    target,
    props: {
      data: {
        ...managerDraftData,
        detail: { ...managerDraftData.detail, id: "exam_upcoming", status: "published" },
      } as never,
      form: null,
    },
  });
  await tick();

  expect(target.textContent).toContain(m.statusPill_exam_scheduled());
  expect(target.textContent).not.toContain(m.examDetail_draftPublishTitle());
  expect(target.querySelector(".text-title.font-bold")).not.toBeNull();

  await unmount(component);
  target.remove();
});

it("shows draft exams in their own course-list section", async () => {
  page.url = new URL("http://localhost/courses/course-1/exams");
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(CourseExamsPage, {
    target,
    props: {
      data: {
        canCreate: false,
        exams: [
          {
            id: "exam_draft",
            title: "Draft exam",
            courseTitle: "Course",
            status: "draft",
            startsAt: "2030-01-01T10:00:00.000Z",
            endsAt: "2030-01-01T12:00:00.000Z",
            durationMinutes: 120,
            scoringMode: "point_sum",
            totalPoints: 100,
            myStatus: null,
          },
          {
            id: "exam_upcoming",
            title: "Published upcoming exam",
            courseTitle: "Course",
            status: "upcoming",
            startsAt: "2030-01-02T10:00:00.000Z",
            endsAt: "2030-01-02T12:00:00.000Z",
            durationMinutes: 120,
            scoringMode: "point_sum",
            totalPoints: 100,
            myStatus: null,
          },
        ],
      } as never,
    },
  });
  await tick();

  const text = target.textContent ?? "";
  expect(text).toContain(m.examsTop_filterDraft());
  expect(text).toContain(m.examsTop_filterUpcoming());
  expect(text).toContain("Draft exam");
  expect(text).toContain("Published upcoming exam");
  expect(text.indexOf(m.examsTop_filterDraft())).toBeLessThan(
    text.indexOf(m.examsTop_filterUpcoming()),
  );

  await unmount(component);
  target.remove();
});
