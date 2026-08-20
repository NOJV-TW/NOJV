// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { Download: Empty, Loader2: Empty, Search: Empty };
});

vi.mock("$lib/components/features/course/submissions/MatrixView.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

describe("AssessmentGradesTab", () => {
  it("renders the score summary, grade matrix, and distribution as one grade workspace", async () => {
    const { default: AssessmentGradesTab } =
      await import("$lib/components/features/coursework/AssessmentGradesTab.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(AssessmentGradesTab, {
      target,
      props: {
        matrix: {
          problems: [{ problemId: "p1", letter: "A", ordinal: 1, title: "A + B", points: 100 }],
          rows: [
            {
              userId: "u1",
              displayName: "Alice",
              handle: "alice",
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
              total: 80,
            },
          ],
          totalPoints: 100,
          studentCount: 1,
        },
        stats: {
          buckets: [{ label: "80–100", count: 1 }],
          submitted: 1,
          classAvg: 80,
          median: 80,
          max: 80,
          min: 80,
          total: 1,
          maxScore: 100,
        },
        csvDownloadName: "grades.csv",
        dataSlot: "test-grade-matrix",
        labels: {
          heading: () => "成績矩陣",
          hint: () => "逐題成績",
          meta: () => "1 位學生",
          student: () => "學生",
          total: () => "總分",
          maxPoints: ({ points }: { points: number }) => `${points}`,
          attempts: ({ count }: { count: number }) => `${count}`,
          searchPlaceholder: () => "搜尋",
          exportCsv: () => "匯出",
          empty: () => "沒有資料",
          legendAc: () => "滿分",
          legendPartial: () => "部分得分",
          legendZero: () => "零分",
          legendEmpty: () => "未提交",
          paginationLabel: () => "1–1",
          prev: () => "上一頁",
          next: () => "下一頁",
        },
      },
    });

    expect(target.textContent).toContain("1/1");
    expect(target.textContent).toContain("Average 80");
    expect(target.textContent).toContain("Median 80");
    expect(target.textContent).toContain("80–100");
    const overview = target.querySelector('[data-slot="grades-overview"]');
    expect(overview?.textContent).toContain("1/1");
    expect(overview?.textContent).toContain("80–100");

    await unmount(component);
    target.remove();
  });
});
