import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import GradesPage from "../../../apps/web/src/routes/(app)/courses/[courseId]/grades/+page.svelte";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return {
    ArrowDown: (await import("../../fixtures/web/arrow-down-icon.svelte")).default,
    ArrowUp: (await import("../../fixtures/web/arrow-up-icon.svelte")).default,
    ArrowUpDown: (await import("../../fixtures/web/arrow-up-down-icon.svelte")).default,
    Download: Empty,
    ListFilter: Empty,
    X: Empty,
  };
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function render(data: unknown) {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(GradesPage, { target, props: { data: data as never } });
  cleanups.push(async () => {
    await unmount(component);
    target.remove();
  });
  return target;
}

const managerData = {
  isManager: true,
  course: { id: "course_1", title: "Course" },
  gradebook: {
    maxTotal: 200,
    columns: [
      {
        contextType: "assignment",
        contextId: "a1",
        contextTitle: "HW 1",
        maxTotal: 200,
        problems: [
          { problemId: "p1", ordinal: 1, title: "First", maxScore: 100, rawMaxScore: 100 },
          { problemId: "p2", ordinal: 2, title: "Second", maxScore: 100, rawMaxScore: 100 },
        ],
      },
    ],
    rows: [
      {
        membershipId: "m1",
        userId: "u1",
        name: "Alice",
        username: "s001",
        cells: { "assignment:a1:p1": 100, "assignment:a1:p2": 20 },
        total: 120,
      },
      {
        membershipId: "m2",
        userId: "u2",
        name: "Bob",
        username: "s002",
        cells: { "assignment:a1:p1": 70, "assignment:a1:p2": 80 },
        total: 150,
      },
    ],
  },
};

function order(target: HTMLElement) {
  return [...target.querySelectorAll("tbody tr")].map((row) =>
    row.querySelector("td div")?.textContent?.trim(),
  );
}

function sortedHeaders(target: HTMLElement) {
  return [...target.querySelectorAll("th[aria-sort]")].map((th) => [
    th.querySelector("button")?.textContent?.trim(),
    th.getAttribute("aria-sort"),
  ]);
}

function sortButton(target: HTMLElement, label: string) {
  const button = [...target.querySelectorAll<HTMLButtonElement>("th button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  return button!;
}

it("keeps a withheld activity column aligned without problem headings", async () => {
  const target = render({
    isManager: false,
    course: { id: "course_1", title: "Course" },
    gradebook: {
      maxTotal: 200,
      columns: [
        {
          contextType: "assignment",
          contextId: "a1",
          contextTitle: "HW 1",
          maxTotal: 100,
          problems: [
            { problemId: "p1", ordinal: 1, title: "Open", maxScore: 100, rawMaxScore: 100 },
          ],
        },
        {
          contextType: "exam",
          contextId: "e1",
          contextTitle: "Final",
          maxTotal: 100,
          problems: [],
        },
      ],
      rows: [
        {
          membershipId: "m1",
          userId: "u1",
          name: "Alice",
          username: "alice",
          cells: { "assignment:a1:p1": 80 },
          total: 80,
        },
      ],
    },
  });
  await tick();
  const [contexts, problems] = target.querySelectorAll("thead tr");
  expect(contexts!.querySelectorAll("th")[2]?.getAttribute("colspan")).toBe("1");
  expect(problems!.querySelectorAll("th")).toHaveLength(2);
  expect(problems!.textContent).toContain(m.courseGradebook_notYetOpen());
  const cells = target.querySelectorAll("tbody tr td");
  expect(cells).toHaveLength(4);
  expect(cells[2]?.textContent?.trim()).toBe("—");
  expect(contexts!.querySelector("th")?.textContent?.trim()).toBe(m.courseGradebook_student());
  expect(
    target.querySelector(`th button[aria-label="${m.courseGradebook_student()}"]`),
  ).toBeNull();
});

it("orders students by total and sorts by a problem from its header", async () => {
  const target = render(managerData);
  await tick();

  expect(order(target)).toEqual(["Bob", "Alice"]);
  expect(sortedHeaders(target)).toEqual([[m.courseGradebook_total(), "descending"]]);

  const problem = m.courseGradebook_problemOrdinal({ n: 1 });
  sortButton(target, problem).click();
  await tick();
  expect(order(target)).toEqual(["Alice", "Bob"]);
  expect(sortedHeaders(target)).toEqual([[problem, "descending"]]);

  sortButton(target, problem).click();
  await tick();
  expect(order(target)).toEqual(["Bob", "Alice"]);
  expect(sortedHeaders(target)).toEqual([[problem, "ascending"]]);
});

async function filterStudents(target: HTMLElement, value: string) {
  target
    .querySelector<HTMLButtonElement>(`th button[aria-label="${m.courseGradebook_student()}"]`)!
    .click();
  const input = await vi.waitFor(() => {
    const field = document.querySelector<HTMLInputElement>("#gradebook-student-filter");
    expect(field).not.toBeNull();
    return field!;
  });
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() =>
    expect(document.querySelector("#gradebook-student-filter")).toBeNull(),
  );
}

it("filters students by name or username and keeps the filter when nothing matches", async () => {
  const target = render(managerData);
  await tick();

  await filterStudents(target, "BOB");
  expect(order(target)).toEqual(["Bob"]);

  await filterStudents(target, "s001");
  expect(order(target)).toEqual(["Alice"]);

  await filterStudents(target, "nobody");
  const cells = target.querySelectorAll("tbody td");
  expect(cells).toHaveLength(1);
  expect(cells[0]?.getAttribute("colspan")).toBe("4");
  expect(cells[0]?.textContent?.trim()).toBe(m.common_noMatches());
  expect(
    target.querySelector(`th button[aria-label="${m.courseGradebook_student()}"]`),
  ).not.toBeNull();
});
