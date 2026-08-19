// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { Download: Empty, Loader2: Empty, Search: Empty };
});

vi.mock("$lib/components/features/course/submissions/MatrixLegend.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("./fixtures/empty-component.svelte")).default,
}));

describe("MatrixView header", () => {
  it("can hide the heading and matrix metadata without hiding its controls", async () => {
    const { default: MatrixView } =
      await import("$lib/components/features/course/submissions/MatrixView.svelte");
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
          sortTotalDesc: () => "依總分",
          sortHandleAsc: () => "依帳號",
          sortNameAsc: () => "依姓名",
          exportCsv: () => "匯出",
          empty: () => "沒有資料",
          legendAc: () => "滿分",
          legendPartial: () => "部分得分",
          legendZero: () => "零分",
          legendEmpty: () => "未提交",
          paginationLabel: () => "0 筆",
          prev: () => "上一頁",
          next: () => "下一頁",
        },
      },
    });

    expect(target.textContent).not.toContain("成績矩陣");
    expect(target.textContent).not.toContain("37 名學生 · 4 題 · 504 分");

    await unmount(component);
    target.remove();
  });

  it("searches from the student header and toggles problem and total sorting", async () => {
    const { default: MatrixView } =
      await import("$lib/components/features/course/submissions/MatrixView.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(MatrixView, {
      target,
      props: {
        matrix: {
          problems: [{ problemId: "p1", letter: "A", ordinal: 1, title: "A + B", points: 100 }],
          rows: [
            {
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
        viewHref: (userId: string) => `/students/${userId}`,
        labels: {
          heading: () => "成績矩陣",
          hint: () => "描述",
          meta: () => "2 名學生",
          student: () => "學生",
          total: () => "總分",
          maxPoints: ({ points }: { points: number }) => `${points}`,
          attempts: ({ count }: { count: number }) => `${count}`,
          searchPlaceholder: () => "搜尋學生",
          sortTotalDesc: () => "依總分",
          sortHandleAsc: () => "依帳號",
          sortNameAsc: () => "依姓名",
          exportCsv: () => "匯出 CSV",
          empty: () => "沒有資料",
          legendAc: () => "滿分",
          legendPartial: () => "部分得分",
          legendZero: () => "零分",
          legendEmpty: () => "未提交",
          paginationLabel: () => "2 筆",
          prev: () => "上一頁",
          next: () => "下一頁",
          viewAction: () => "查看提交",
        },
      },
    });

    expect(target.querySelector('input[placeholder="搜尋學生"]')?.closest("th")).not.toBeNull();
    expect(target.querySelectorAll("select")).toHaveLength(0);
    expect(target.textContent).not.toContain("查看提交");

    const problemSort = [...target.querySelectorAll("thead button")].find((button) =>
      button.textContent?.includes("A"),
    ) as HTMLButtonElement;
    const totalSort = [...target.querySelectorAll("thead button")].find((button) =>
      button.textContent?.includes("總分"),
    );
    expect(problemSort).toBeDefined();
    expect(totalSort).toBeDefined();

    problemSort.click();
    await Promise.resolve();
    expect(target.querySelector("tbody tr td")?.textContent).toContain("Bob");
    problemSort.click();
    await Promise.resolve();
    expect(target.querySelector("tbody tr td")?.textContent).toContain("Alice");

    await unmount(component);
    target.remove();
  });
});
