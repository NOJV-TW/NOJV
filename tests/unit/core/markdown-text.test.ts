import { describe, expect, it } from "vitest";

import { markdownToPlainText, truncateText } from "@nojv/core";

const CODE_FENCE = "```";

describe("markdownToPlainText", () => {
  it("strips block syntax and keeps readable text", () => {
    const text = markdownToPlainText(
      "# 標題\n\n> 引言\n\n- 第一點\n- **第二點**\n\n1. one\n2. `code`\n\n---\n",
    );
    expect(text).toBe("標題 引言 第一點 第二點 one code");
  });

  it("drops images but keeps link text", () => {
    expect(
      markdownToPlainText(
        "看圖 ![screenshot.png](/api/storage/x.png) 與 [連結](https://nojv.tw)",
      ),
    ).toBe("看圖 與 連結");
  });

  it("removes raw html tags and table pipes", () => {
    expect(markdownToPlainText("<b>bold</b> | a | b |\n|---|---|\n| 1 | 2 |")).toBe(
      "bold a b 1 2",
    );
  });

  it("keeps underscores inside identifiers while stripping emphasis", () => {
    expect(markdownToPlainText("use snake_case_name and _em_")).toBe(
      "use snake_case_name and em",
    );
  });

  it("keeps fenced code contents", () => {
    expect(markdownToPlainText("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("keeps text around a fence and drops an unclosed fence marker", () => {
    expect(markdownToPlainText("before\n\n```ts\nconst x = 1;\n```\n\nafter")).toBe(
      "before const x = 1; after",
    );
    expect(markdownToPlainText("intro\n\n```sh\nls -la")).toBe("intro ls -la");
  });

  it("stays linear on a long run of fence markers", () => {
    const start = performance.now();
    expect(markdownToPlainText(CODE_FENCE.repeat(20_000))).toBe("");
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it("strips task list markers", () => {
    expect(markdownToPlainText("- [x] done\n- [ ] todo")).toBe("done todo");
  });
});

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("abc", 5)).toBe("abc");
  });

  it("appends an ellipsis while staying within the limit", () => {
    const out = truncateText("a".repeat(20), 10);
    expect(out).toBe(`${"a".repeat(9)}…`);
    expect(out).toHaveLength(10);
  });
});
