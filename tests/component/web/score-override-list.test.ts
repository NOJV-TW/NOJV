import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import FeedbackList from "$lib/components/features/score-override/FeedbackList.svelte";
import ScoreOverrideDrawer from "$lib/components/features/score-override/ScoreOverrideDrawer.svelte";
import ScoreOverrideList from "$lib/components/features/score-override/ScoreOverrideList.svelte";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return {
    ArrowDown: (await import("../../fixtures/web/arrow-down-icon.svelte")).default,
    ArrowUp: (await import("../../fixtures/web/arrow-up-icon.svelte")).default,
    ArrowUpDown: (await import("../../fixtures/web/arrow-up-down-icon.svelte")).default,
    ListFilter: Empty,
    Loader2: Empty,
    Pencil: Empty,
    Trash2: Empty,
    X: Empty,
  };
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
});

const students = [
  { rowId: "m1", courseMembershipId: "m1", userId: "u1", username: "alice01", name: "Alice" },
  { rowId: "m2", courseMembershipId: "m2", userId: "u2", username: "bob02", name: "Bob" },
];
const problems = [
  { id: "p1", title: "A + B" },
  { id: "p2", title: "Graph" },
];

function override(
  id: string,
  courseMembershipId: string,
  problemId: string,
  overrideScore: number,
  updatedAt: string,
) {
  return {
    id,
    courseMembershipId,
    problemId,
    overrideScore,
    reason: `reason-${id}`,
    updatedAt,
    createdByUserId: "staff",
    updatedByUserId: "staff",
  };
}

function render(component: typeof ScoreOverrideList | typeof FeedbackList, rows: unknown[]) {
  const target = document.createElement("div");
  document.body.append(target);
  const instance = mount(component as typeof ScoreOverrideList, {
    target,
    props: { rows: rows as never, students, problems, onedit: vi.fn(), ondelete: vi.fn() },
  });
  cleanups.push(async () => {
    await unmount(instance);
    target.remove();
  });
  return target;
}

function order(target: HTMLElement) {
  return [...target.querySelectorAll("tbody td[title]")].map((cell) =>
    cell.getAttribute("title"),
  );
}

function sortButton(target: HTMLElement, label: string) {
  const button = [...target.querySelectorAll<HTMLButtonElement>("th button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  return button!;
}

function sortedHeaders(target: HTMLElement) {
  return [...target.querySelectorAll("th[aria-sort]")].map((th) => [
    th.textContent?.trim(),
    th.getAttribute("aria-sort"),
  ]);
}

async function filterText(target: HTMLElement, label: string, inputId: string, value: string) {
  target.querySelector<HTMLButtonElement>(`th button[aria-label="${label}"]`)!.click();
  const input = await vi.waitFor(() => {
    const field = document.querySelector<HTMLInputElement>(`#${inputId}`);
    expect(field).not.toBeNull();
    return field!;
  });
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector(`#${inputId}`)).toBeNull());
}

async function filterSelect(target: HTMLElement, label: string, value: string) {
  target
    .querySelector<HTMLButtonElement>(`th button[aria-label="${label}"]`)!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await tick();
  const option = await vi.waitFor(() => {
    const item = document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
    expect(item).not.toBeNull();
    return item!;
  });
  option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  await tick();
}

it("lists overrides newest first and sorts by score from the header", async () => {
  const target = render(ScoreOverrideList, [
    override("o1", "m1", "p1", 95, "2026-09-01T00:00:00.000Z"),
    override("o2", "m2", "p1", 90, "2026-09-03T00:00:00.000Z"),
    override("o3", "m1", "p2", 20, "2026-09-02T00:00:00.000Z"),
  ]);
  await tick();

  expect(order(target)).toEqual(["reason-o2", "reason-o3", "reason-o1"]);
  expect(sortedHeaders(target)).toEqual([[m.common_updatedAt(), "descending"]]);

  sortButton(target, m.override_staff_fieldScore()).click();
  await tick();
  expect(order(target)).toEqual(["reason-o1", "reason-o2", "reason-o3"]);
  expect(sortedHeaders(target)).toEqual([[m.override_staff_fieldScore(), "descending"]]);

  sortButton(target, m.override_staff_fieldScore()).click();
  await tick();
  expect(order(target)).toEqual(["reason-o3", "reason-o2", "reason-o1"]);
  expect(sortedHeaders(target)).toEqual([[m.override_staff_fieldScore(), "ascending"]]);
});

it("filters overrides by student and problem and keeps the filters when nothing matches", async () => {
  const target = render(ScoreOverrideList, [
    override("o1", "m1", "p1", 95, "2026-09-01T00:00:00.000Z"),
    override("o2", "m2", "p1", 90, "2026-09-03T00:00:00.000Z"),
    override("o3", "m1", "p2", 20, "2026-09-02T00:00:00.000Z"),
  ]);
  await tick();

  await filterText(target, m.override_staff_fieldStudent(), "override-student-filter", "ALICE");
  expect(order(target)).toEqual(["reason-o3", "reason-o1"]);

  await filterSelect(target, m.override_staff_fieldProblem(), "p1");
  expect(order(target)).toEqual(["reason-o1"]);

  await filterText(target, m.override_staff_fieldStudent(), "override-student-filter", "bob");
  expect(order(target)).toEqual(["reason-o2"]);

  await filterText(
    target,
    m.override_staff_fieldStudent(),
    "override-student-filter",
    "nobody",
  );
  expect(order(target)).toEqual([]);
  expect(target.querySelector("tbody")?.textContent).toContain(m.common_noMatches());
  expect(
    target.querySelector(`th button[aria-label="${m.override_staff_fieldStudent()}"]`),
  ).not.toBeNull();
  expect(
    target.querySelector(`th button[aria-label="${m.override_staff_fieldProblem()}"]`),
  ).not.toBeNull();
  expect(target.textContent).not.toContain(m.override_staff_emptyList());
});

it("keeps the empty state when there are no overrides", async () => {
  const target = render(ScoreOverrideList, []);
  await tick();

  expect(target.textContent).toContain(m.override_staff_emptyList());
  expect(target.querySelector("table")).toBeNull();
});

it("lists feedback newest first and filters it by student and problem", async () => {
  const feedback = (
    id: string,
    courseMembershipId: string,
    problemId: string,
    updatedAt: string,
  ) => ({
    id,
    courseMembershipId,
    problemId,
    comment: `comment-${id}`,
    updatedAt,
  });
  const target = render(FeedbackList, [
    feedback("f1", "m1", "p1", "2026-09-01T00:00:00.000Z"),
    feedback("f2", "m2", "p1", "2026-09-03T00:00:00.000Z"),
    feedback("f3", "m1", "p2", "2026-09-02T00:00:00.000Z"),
  ]);
  await tick();

  expect(order(target)).toEqual(["comment-f2", "comment-f3", "comment-f1"]);
  expect(sortedHeaders(target)).toEqual([[m.common_updatedAt(), "descending"]]);

  await filterText(target, m.feedback_staff_fieldStudent(), "feedback-student-filter", "bob02");
  expect(order(target)).toEqual(["comment-f2"]);

  sortButton(target, m.common_updatedAt()).click();
  await tick();
  await filterText(target, m.feedback_staff_fieldStudent(), "feedback-student-filter", "alice");
  expect(order(target)).toEqual(["comment-f1", "comment-f3"]);
  expect(sortedHeaders(target)).toEqual([[m.common_updatedAt(), "ascending"]]);

  await filterSelect(target, m.feedback_staff_fieldProblem(), "p2");
  expect(order(target)).toEqual(["comment-f3"]);
});

it("keeps override filters while the drawer reloads after a delete", async () => {
  let overrideLoads = 0;
  let release: () => void = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (input.includes("/api/feedback")) return Response.json({ items: [] });
      overrideLoads += 1;
      const items = [
        override("o1", "m1", "p1", 95, "2026-09-01T00:00:00.000Z"),
        override("o2", "m2", "p1", 90, "2026-09-03T00:00:00.000Z"),
      ];
      if (overrideLoads === 1)
        return Response.json({
          items: [...items, override("o3", "m1", "p2", 20, "2026-09-02T00:00:00.000Z")],
        });
      await new Promise<void>((resolve) => (release = resolve));
      return Response.json({ items });
    }),
  );
  const target = document.createElement("div");
  document.body.append(target);
  const instance = mount(ScoreOverrideDrawer, {
    target,
    props: {
      open: true,
      onOpenChange: vi.fn(),
      contextType: "assignment",
      contextId: "assignment-1",
      students,
      problems,
    },
  });
  cleanups.push(async () => {
    await unmount(instance);
    target.remove();
  });
  const body = document.body;
  const clearStudent = `button[aria-label="${m.common_clearFilter({ label: m.override_staff_fieldStudent() })}"]`;

  await vi.waitFor(() => expect(order(body)).toHaveLength(3));
  await filterText(body, m.override_staff_fieldStudent(), "override-student-filter", "alice");
  expect(order(body)).toEqual(["reason-o3", "reason-o1"]);

  body
    .querySelector("tbody td[title='reason-o3']")!
    .closest("tr")!
    .querySelector<HTMLButtonElement>(`button[aria-label="${m.override_staff_deleteBtn()}"]`)!
    .click();
  await tick();
  [...body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((button) => button.textContent?.trim() === m.override_staff_deleteBtn())!
    .click();
  await vi.waitFor(() => expect(overrideLoads).toBe(2));
  await tick();
  expect(body.querySelector(clearStudent)).not.toBeNull();
  expect(order(body)).toEqual(["reason-o3", "reason-o1"]);

  release();
  await vi.waitFor(() => expect(order(body)).toEqual(["reason-o1"]));
  expect(body.querySelector(clearStudent)).not.toBeNull();
});
