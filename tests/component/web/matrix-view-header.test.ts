// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import MatrixView from "$lib/components/features/course/submissions/MatrixView.svelte";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return {
    ArrowDown: (await import("../../fixtures/web/arrow-down-icon.svelte")).default,
    ArrowUp: (await import("../../fixtures/web/arrow-up-icon.svelte")).default,
    ArrowUpDown: (await import("../../fixtures/web/arrow-up-down-icon.svelte")).default,
    Download: Empty,
    ListFilter: Empty,
    Loader2: Empty,
    Search: Empty,
    X: Empty,
  };
});

vi.mock("$lib/components/features/course/submissions/MatrixLegend.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("../../fixtures/web/empty-component.svelte")).default,
}));

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

async function searchStudents(target: HTMLElement, value: string) {
  target.querySelector<HTMLButtonElement>('th button[aria-label="搜尋學生"]')!.click();
  const input = await vi.waitFor(() => {
    const field = document.querySelector<HTMLInputElement>("#matrix-student-filter");
    expect(field).not.toBeNull();
    return field!;
  });
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector("#matrix-student-filter")).toBeNull());
}

describe("MatrixView header", () => {
  it("can hide the heading and matrix metadata without hiding its controls", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(MatrixView, {
      target,
      props: {
        matrix: {
          problems: [{ problemId: "p1", letter: "A", ordinal: 1, title: "A + B", points: 100 }],
          rows: [],
          totalPoints: 100,
          studentCount: 37,
        },
        csvDownloadName: "grades.csv",
        dataSlot: "matrix-test",
        showHeader: false,
        labels: {
          heading: () => "成績矩陣",
          hint: () => "描述",
          meta: () => "37 名學生 · 4 題 · 504 分",
          student: () => "學生",
          total: () => "總分",
          maxPoints: ({ points }: { points: number }) => `${points}`,
          attempts: ({ count }: { count: number }) => `${count}`,
          searchPlaceholder: () => "搜尋學生",
          exportCsv: () => "匯出",
          empty: () => "沒有資料",
          legendAc: () => "滿分",
          legendPartial: () => "部分得分",
          legendZero: () => "零分",
          legendEmpty: () => "未提交",
        },
      },
    });

    expect(target.textContent).not.toContain("成績矩陣");
    expect(target.textContent).not.toContain("37 名學生 · 4 題 · 504 分");

    await unmount(component);
    target.remove();
  });

  it("searches from the student header and toggles problem and total sorting", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(MatrixView, {
      target,
      props: {
        matrix: {
          problems: [{ problemId: "p1", letter: "A", ordinal: 1, title: "A + B", points: 100 }],
          rows: [
            {
              rowId: "membership-1",
              courseMembershipId: "membership-1",
              userId: "u1",
              displayName: "Alice",
              handle: "s001",
              total: 100,
              cells: [
                {
                  problemId: "p1",
                  score: 20,
                  attempts: 1,
                  state: "partial",
                  practiceScore: null,
                  practiceAttempts: 0,
                },
              ],
            },
            {
              rowId: "membership-2",
              courseMembershipId: "membership-2",
              userId: "u2",
              displayName: "Bob",
              handle: "s002",
              total: 50,
              cells: [
                {
                  problemId: "p1",
                  score: 80,
                  attempts: 1,
                  state: "partial",
                  practiceScore: null,
                  practiceAttempts: 0,
                },
              ],
            },
          ],
          totalPoints: 100,
          studentCount: 2,
        },
        csvDownloadName: "grades.csv",
        dataSlot: "matrix-sort-test",
        labels: {
          heading: () => "成績矩陣",
          hint: () => "描述",
          meta: () => "2 名學生",
          student: () => "學生",
          total: () => "總分",
          maxPoints: ({ points }: { points: number }) => `${points}`,
          attempts: ({ count }: { count: number }) => `${count}`,
          searchPlaceholder: () => "搜尋學生",
          exportCsv: () => "匯出 CSV",
          empty: () => "沒有資料",
          legendAc: () => "滿分",
          legendPartial: () => "部分得分",
          legendZero: () => "零分",
          legendEmpty: () => "未提交",
        },
      },
    });

    expect(target.querySelector('th button[aria-label="搜尋學生"]')).not.toBeNull();
    expect(target.querySelectorAll("select")).toHaveLength(0);
    expect(target.textContent).not.toContain("查看提交");

    expect(order(target)).toEqual(["Alice", "Bob"]);
    expect(sortedHeaders(target)).toEqual([["總分", "descending"]]);

    sortButton(target, "A").click();
    await tick();
    expect(order(target)).toEqual(["Bob", "Alice"]);
    expect(sortedHeaders(target)).toEqual([["A", "descending"]]);

    sortButton(target, "A").click();
    await tick();
    expect(order(target)).toEqual(["Alice", "Bob"]);
    expect(sortedHeaders(target)).toEqual([["A", "ascending"]]);

    sortButton(target, "總分").click();
    await tick();
    expect(order(target)).toEqual(["Alice", "Bob"]);
    expect(sortedHeaders(target)).toEqual([["總分", "descending"]]);

    sortButton(target, "總分").click();
    await tick();
    expect(order(target)).toEqual(["Bob", "Alice"]);
    expect(sortedHeaders(target)).toEqual([["總分", "ascending"]]);

    await searchStudents(target, "s002");
    expect(order(target)).toEqual(["Bob"]);

    await searchStudents(target, "ALICE");
    expect(order(target)).toEqual(["Alice"]);

    await searchStudents(target, "nobody");
    const cells = target.querySelectorAll("tbody td");
    expect(cells).toHaveLength(1);
    expect(cells[0]?.getAttribute("colspan")).toBe("3");
    expect(cells[0]?.textContent?.trim()).toBe(m.common_noMatches());
    expect(target.querySelector('th button[aria-label="搜尋學生"]')).not.toBeNull();

    await unmount(component);
    target.remove();
  });
});
