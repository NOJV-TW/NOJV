// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScoreOverrideForm from "$lib/components/features/score-override/ScoreOverrideForm.svelte";
import FeedbackForm from "$lib/components/features/score-override/FeedbackForm.svelte";
import AuditTimeline from "$lib/components/features/audit/AuditTimeline.svelte";
import MatrixView from "$lib/components/features/course/submissions/MatrixView.svelte";

vi.mock("$lib/stores/toast", () => ({ toasts: { success: vi.fn(), error: vi.fn() } }));
vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/course/submissions/MatrixLegend.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
const fetchMock = vi.fn();
const students = [
  {
    rowId: "membership-1",
    courseMembershipId: "membership-1",
    userId: null,
    name: "Pending One",
    username: "pending_one",
  },
  {
    rowId: "membership-2",
    courseMembershipId: "membership-2",
    userId: null,
    name: "Pending Two",
    username: "pending_two",
  },
];
const problems = [
  { id: "problem-1", title: "A" },
  { id: "problem-2", title: "B" },
];

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
  vi.unstubAllGlobals();
});

function fill(selector: string, value: string) {
  const input = target.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function submit() {
  target
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  return JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
}

describe("roster grading controls", () => {
  it("renders a merge audit entry with a nullable historical user", () => {
    component = mount(AuditTimeline, {
      target,
      props: {
        actorNames: {},
        events: [
          {
            kind: "score_override",
            at: new Date("2026-09-07T00:00:00Z"),
            actorUserId: null,
            detail: {
              action: "merge",
              userId: null,
              problemId: "problem",
              oldScore: 80,
              newScore: 90,
              oldReason: "Prior grade",
              newReason: "Roster grade",
            },
          },
        ],
      },
    });
    expect(target.textContent).toContain("Course records merged: 80 → 90");
    expect(target.textContent).toContain("System");
    expect(target.querySelectorAll("a")).toHaveLength(0);
  });

  it.each(["assignment", "exam"] as const)(
    "submits the selected pending membership for %s",
    async (contextType) => {
      component = mount(ScoreOverrideForm, {
        target,
        props: {
          mode: "create",
          contextType,
          contextId: "context",
          students,
          problems,
          initialRowId: "membership-2",
          initialProblemId: "problem-2",
          onsuccess: vi.fn(),
        },
      });
      await tick();
      expect((target.querySelector("#ov-student") as HTMLSelectElement).value).toBe(
        "membership-2",
      );
      expect(target.textContent).toContain("Not yet activated");
      fill("#ov-reason", "Manual grading");
      const body = await submit();
      expect(body).toMatchObject({
        courseMembershipId: "membership-2",
        problemId: "problem-2",
      });
      expect(body).not.toHaveProperty("userId");
      expect(body).not.toHaveProperty("rowId");
    },
  );

  it("submits an actual user for contest grading", async () => {
    component = mount(ScoreOverrideForm, {
      target,
      props: {
        mode: "create",
        contextType: "contest",
        contextId: "contest",
        students: [
          {
            rowId: "contest-user",
            courseMembershipId: null,
            userId: "contest-user",
            name: "Contest User",
            username: "contest_user",
          },
        ],
        problems,
        onsuccess: vi.fn(),
      },
    });
    fill("#ov-reason", "Manual grading");
    const body = await submit();
    expect(body.userId).toBe("contest-user");
    expect(body).not.toHaveProperty("courseMembershipId");
  });

  it("prefills feedback using the clicked membership and problem", async () => {
    component = mount(FeedbackForm, {
      target,
      props: {
        mode: "create",
        contextType: "exam",
        contextId: "exam",
        students,
        problems,
        initialCourseMembershipId: "membership-2",
        initialProblemId: "problem-2",
        onsuccess: vi.fn(),
      },
    });
    await tick();
    expect((target.querySelector("#fb-student") as HTMLSelectElement).value).toBe(
      "membership-2",
    );
    fill("#fb-comment", "Review the boundary case.");
    const body = await submit();
    expect(body).toMatchObject({ courseMembershipId: "membership-2", problemId: "problem-2" });
    expect(body).not.toHaveProperty("studentUserId");
    expect(body).not.toHaveProperty("userId");
  });

  it("renders multiple null-user rows and passes stable row IDs when grading", async () => {
    const oncellclick = vi.fn();
    component = mount(MatrixView, {
      target,
      props: {
        matrix: {
          problems: [
            { problemId: "problem-1", letter: "A", ordinal: 1, title: "A", points: 100 },
          ],
          rows: students.map((s) => ({
            ...s,
            displayName: s.name,
            handle: s.username,
            total: 80,
            cells: [
              {
                problemId: "problem-1",
                score: 80,
                state: "partial",
                attempts: 0,
                practiceScore: null,
                practiceAttempts: 0,
              },
            ],
          })),
          totalPoints: 100,
          studentCount: 2,
        },
        csvDownloadName: "grades.csv",
        dataSlot: "pending-matrix",
        oncellclick,
        labels: {
          heading: () => "Grades",
          hint: () => "",
          meta: () => "2 students",
          student: () => "Student",
          total: () => "Total",
          maxPoints: ({ points }) => `${points}`,
          attempts: ({ count }) => `${count} attempts`,
          searchPlaceholder: () => "Search students",
          exportCsv: () => "Export",
          empty: () => "Empty",
          legendAc: () => "AC",
          legendPartial: () => "Partial",
          legendZero: () => "Zero",
          legendEmpty: () => "Empty",
          paginationLabel: () => "2 rows",
          prev: () => "Previous",
          next: () => "Next",
          gradeCellTitle: () => "Grade",
        },
      },
    });
    expect(target.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(target.querySelectorAll("tbody a")).toHaveLength(0);
    expect(target.textContent).toContain("0 attempts");
    (target.querySelectorAll("tbody button")[1] as HTMLButtonElement).click();
    expect(oncellclick).toHaveBeenCalledWith("membership-2", "problem-1");
    fill('input[type="search"]', "pending_two");
    await vi.waitFor(() => expect(target.querySelectorAll("tbody tr")).toHaveLength(1));
    expect(target.querySelector("tbody")?.textContent).toContain("Pending Two");
  });
});
