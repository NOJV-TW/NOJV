// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { page } from "$app/state";
import { describe, expect, it, vi } from "vitest";
import { groupExamRows } from "#lib/components/features/course/exam/exam-list-groups.js";
import { m } from "#lib/paraglide/messages.js";
import ExamPage from "../../../apps/web/src/routes/(app)/exams/[examId]/+page.svelte";

vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$app/navigation", () => ({
  beforeNavigate: () => {},
  goto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return { ChevronRight: Empty, Monitor: Empty, Pencil: Empty, X: Empty };
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
  expect(target.querySelector('a[href="/exams/exam_draft?tab=settings"]')?.textContent).toContain(
    m.examDetail_draftPublishAction(),
  );

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

  await unmount(component);
  target.remove();
});
