import { describe, expect, it } from "vitest";

import { markdownToPlainText, truncateText } from "@nojv/core";

const CODE_FENCE = "```";
const LINEAR_INPUT_CHARS = 1_000_000;
const LINEAR_BUDGET_MS = 5_000;

function repeatToLength(unit: string, chars: number): string {
  return unit.repeat(Math.ceil(chars / unit.length));
}

function elapsedOnLargeInput(generate: (chars: number) => string): number {
  markdownToPlainText(generate(10_000));
  const input = generate(LINEAR_INPUT_CHARS);
  const start = performance.now();
  markdownToPlainText(input);
  return performance.now() - start;
}

function nestedImages(chars: number): string {
  const depth = Math.ceil(chars / 6);
  return `${"![".repeat(depth)}a${"](b)".repeat(depth)}`;
}

function manyBacktickLengths(chars: number): string {
  let text = "";
  for (let length = 1000; length >= 2; length--) text += `${"`".repeat(length)}a`;
  return text + repeatToLength("`x`", Math.max(3, chars - text.length));
}

function hasLoneSurrogate(text: string): boolean {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch.length === 1 && code >= 0xd800 && code <= 0xdfff) return true;
  }
  return false;
}

function linkHeadWithLongTail(chars: number): string {
  const half = Math.floor(chars / 2);
  return `${"[".repeat(half)}](${"x".repeat(half)}`;
}

function unclosedDestinations(chars: number): string {
  return `${repeatToLength("[a](", chars)} z`;
}

function unclosedTitles(chars: number): string {
  return `${repeatToLength("[a](x '", chars)} z`;
}

function tagCandidatesWithOneCloser(chars: number): string {
  return `${repeatToLength("<a ", chars)}>`;
}

function tagAttributeCandidates(chars: number): string {
  return `${repeatToLength('<a b="', chars)}>`;
}

const BACKSLASH = String.fromCharCode(92);

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
    expect(markdownToPlainText("|a|b|\n|-|-|\n|1|2|")).toBe("a b 1 2");
    expect(markdownToPlainText("| a | b |\n|:-:|:-|\n| 1 | 2 |")).toBe("a b 1 2");
  });

  it("keeps underscores inside identifiers while stripping emphasis", () => {
    expect(markdownToPlainText("use snake_case_name and _em_")).toBe(
      "use snake_case_name and em",
    );
    expect(markdownToPlainText("檔名格式：學號_姓名_作業.zip 與 「_強調_」")).toBe(
      "檔名格式：學號_姓名_作業.zip 與 「強調」",
    );
  });

  it("keeps balanced parentheses inside link destinations", () => {
    expect(
      markdownToPlainText(
        "[維基](https://zh.wikipedia.org/wiki/Python_(programming_language)) 請看",
      ),
    ).toBe("維基 請看");
    expect(markdownToPlainText("[a](b(c)d) e")).toBe("a e");
  });

  it("strips headings and quotes nested inside list items and closing hash sequences", () => {
    expect(markdownToPlainText("- # 標題\n1. ## 第一章\n- > 引用\n- - 巢狀")).toBe(
      "標題 第一章 引用 巢狀",
    );
    expect(markdownToPlainText("## 標題 ##")).toBe("標題");
    expect(markdownToPlainText("# C#")).toBe("C#");
  });

  it("keeps fenced code contents", () => {
    expect(markdownToPlainText("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
    expect(markdownToPlainText("~~~\n**x**\n~~~")).toBe("**x**");
    expect(markdownToPlainText("```\n#include <iostream>\nint *p;\n```")).toBe(
      "#include <iostream> int *p;",
    );
  });

  it("strips task list markers", () => {
    expect(markdownToPlainText("- [x] done\n- [ ] todo\n- [X] upper")).toBe("done todo upper");
  });

  it("strips nested list markers at any indentation", () => {
    expect(markdownToPlainText("- 作業\n    - 第一題\n    - 第二題")).toBe(
      "作業 第一題 第二題",
    );
    expect(markdownToPlainText("9. 第九\n10. 第十\n    - 子項\n    - [ ] 待辦")).toBe(
      "第九 第十 子項 待辦",
    );
  });

  it("keeps text around a fence and drops an unclosed fence marker", () => {
    expect(markdownToPlainText("before\n\n```ts\nconst x = 1;\n```\n\nafter")).toBe(
      "before const x = 1; after",
    );
    expect(markdownToPlainText("intro\n\n```sh\nls -la")).toBe("intro ls -la");
  });

  it("treats a single-line triple-backtick span as inline code", () => {
    expect(markdownToPlainText("```inline```")).toBe("inline");
  });

  it("protects inline code spans from markup stripping", () => {
    expect(markdownToPlainText("請 include `<bits/stdc++.h>` 標頭")).toBe(
      "請 include <bits/stdc++.h> 標頭",
    );
    expect(markdownToPlainText("`a*b*c` and `x_y_z` and `[t](u)`")).toBe(
      "a*b*c and x_y_z and [t](u)",
    );
    expect(markdownToPlainText("`` a ` b ``")).toBe("a ` b");
    expect(markdownToPlainText("unclosed ` tick")).toBe("unclosed tick");
    expect(markdownToPlainText("\\\\`<b>`")).toBe("\\<b>");
  });

  it("lets an escaped backtick close an open code span", () => {
    expect(markdownToPlainText(`路徑 \`C:${BACKSLASH}Users${BACKSLASH}\` 與 \`y\``)).toBe(
      `路徑 C:${BACKSLASH}Users${BACKSLASH} 與 y`,
    );
    expect(markdownToPlainText(`\\\`not code\\\` 與 \`real\``)).toBe("`not code` 與 real");
  });

  it("resolves reference links and drops their definitions", () => {
    expect(
      markdownToPlainText(
        "請參考 [課程規範][1] 與 [評分標準][grade]\n\n[1]: https://a\n[grade]: https://b",
      ),
    ).toBe("請參考 課程規範 與 評分標準");
    expect(markdownToPlainText("[NOJV][] 是我們的平台\n\n[NOJV]: https://nojv.tw")).toBe(
      "NOJV 是我們的平台",
    );
  });

  it("accepts angle-bracketed link destinations", () => {
    expect(markdownToPlainText("[a](<b c>) d")).toBe("a d");
    expect(markdownToPlainText("[a](<https://nojv.tw/x y>) d")).toBe("a d");
  });

  it("keeps astral characters from breaking the intraword underscore rule", () => {
    expect(markdownToPlainText("\u{21619}_b_ x")).toBe("\u{21619}_b_ x");
    expect(markdownToPlainText("王_b_ x")).toBe("王_b_ x");
  });

  it("replaces entities for invalid code points", () => {
    const out = markdownToPlainText("a&#xD800;b &#0;c &#x110000;d &#99;e");
    expect(out).toBe("a�b �c �d ce");
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it("does not let inline markup span block boundaries", () => {
    expect(markdownToPlainText("- a*b\n- c*d")).toBe("a*b c*d");
    expect(markdownToPlainText("# *a\nb*")).toBe("*a b*");
    expect(markdownToPlainText("| a*b |\n|---|\n| c*d |")).toBe("a*b c*d");
    expect(markdownToPlainText("- item\n===")).toBe("item ===");
  });

  it("keeps autolink targets and drops html comments", () => {
    expect(markdownToPlainText("詳見 <https://nojv.tw/course/1> 或 <admin@nojv.tw>")).toBe(
      "詳見 https://nojv.tw/course/1 或 admin@nojv.tw",
    );
    expect(markdownToPlainText("<!-- hidden -->visible")).toBe("visible");
    expect(markdownToPlainText("a <!-- open comment")).toBe("a <!-- open comment");
  });

  it("only strips spans that are real html tags", () => {
    expect(markdownToPlainText("若 a<b 且 c>d 則成立")).toBe("若 a<b 且 c>d 則成立");
    expect(markdownToPlainText("if (a<b) 且 x>y")).toBe("if (a<b) 且 x>y");
    expect(markdownToPlainText('<img src="/x.png" alt="圖">文字<br/>下一行</div>')).toBe(
      "文字 下一行",
    );
    expect(markdownToPlainText("<a href='u' data-x=1>連結</a>")).toBe("連結");
    expect(markdownToPlainText('<a title="x>y">文字</a>')).toBe("文字");
    expect(markdownToPlainText("<a -b>x")).toBe("<a -b>x");
  });

  it("joins soft line breaks so inline constructs can span lines", () => {
    expect(markdownToPlainText("請見 [課程\n公告](https://nojv.tw/a) 謝謝")).toBe(
      "請見 課程 公告 謝謝",
    );
    expect(markdownToPlainText("![多行\nalt](/x.png) 後")).toBe("後");
    expect(markdownToPlainText('<img\n  src="/x.png"\n  alt="圖">文字')).toBe("文字");
    expect(markdownToPlainText("第一段 **粗\n\n體** 第二段")).toBe("第一段 **粗 體** 第二段");
  });

  it("decodes common html entities", () => {
    expect(markdownToPlainText("&lt;b&gt; C&amp;C++ &#20013;&#x6587; &unknown; &amp")).toBe(
      "<b> C&C++ 中文 &unknown; &amp",
    );
  });

  it("does not treat destinations containing spaces as links", () => {
    expect(markdownToPlainText("[a](b c) d")).toBe("[a](b c) d");
    expect(markdownToPlainText('[a](b "title") d')).toBe("a d");
  });

  it("honors backslash escapes", () => {
    expect(markdownToPlainText("\\*a\\* and \\| pipe and \\[x](y)")).toBe(
      "*a* and | pipe and [x](y)",
    );
  });

  it("handles nested block prefixes, setext underlines, and CRLF input", () => {
    expect(markdownToPlainText("> # 標題\r\n> > 引言\r\n> - 項目")).toBe("標題 引言 項目");
    expect(markdownToPlainText("標題\n===\n內文\n---")).toBe("標題 內文");
    expect(markdownToPlainText("text\n```\ncode\n```\n===")).toBe("text code ===");
    expect(markdownToPlainText("> ---\n> text")).toBe("text");
    expect(markdownToPlainText("> ```\n> **x**\n> ```")).toBe("**x**");
  });

  it("matches the bracket that actually closes a link", () => {
    expect(markdownToPlainText("[必讀] 請看 [公告](https://nojv.tw)")).toBe("[必讀] 請看 公告");
    expect(markdownToPlainText("[a [b](c)")).toBe("[a b");
    expect(markdownToPlainText("![a] ![b](x) c")).toBe("![a] c");
  });

  it("drops an image nested inside a link along with the link target", () => {
    expect(markdownToPlainText("看 [![封面](/img.png)](/post) 這篇")).toBe("看 這篇");
  });

  it("leaves unpaired markers and unclosed constructs as literal text", () => {
    expect(markdownToPlainText("5 * 3 = 15 and a**b")).toBe("5 * 3 = 15 and a**b");
    expect(markdownToPlainText("[text](url")).toBe("[text](url");
    expect(markdownToPlainText("a < b and c > d and <3 you")).toBe(
      "a < b and c > d and <3 you",
    );
  });

  it("strips strikethrough and nested emphasis", () => {
    expect(markdownToPlainText("~~舊~~ ***新*** __粗__")).toBe("舊 新 粗");
  });

  it.each([
    ["1234567890. not a list", "1234567890. not a list"],
    ["####### not a heading", "####### not a heading"],
    ["#tag stays", "#tag stays"],
    ["****x****", "****x****"],
    ["~x~ single tilde", "~x~ single tilde"],
    ["3) paren marker", "paren marker"],
    ["* * *", ""],
    ["___", ""],
    ["   - three spaces", "three spaces"],
    ["    plain indented text", "plain indented text"],
    ["<1> not a tag", "<1> not a tag"],
    ["- ", ""],
  ])("pins boundary case %j", (input, expected) => {
    expect(markdownToPlainText(input)).toBe(expected);
  });

  it.each([
    ["fence markers", CODE_FENCE],
    ["image openers", "!["],
    ["empty image heads", "![]("],
    ["link openers", "["],
    ["link closers", "]("],
    ["empty link heads", "[]("],
    ["tag openers", "<a"],
    ["closed tags", "<a>"],
    ["comment openers", "<!--"],
    ["asterisk runs", "*a"],
    ["underscore runs", "_a "],
    ["tilde runs", "~~a"],
    ["backticks", "`"],
    ["backtick pairs", "`a``"],
    ["escapes", "\\*"],
    ["pipes", "|"],
    ["list markers", "- "],
    ["heading markers", "#"],
    ["quote markers", "> "],
    ["mixed openers on one line", "![[<a*_`\\"],
  ])("stays linear on a long run of %s", (_label, unit) => {
    expect(elapsedOnLargeInput((chars) => repeatToLength(unit, chars))).toBeLessThan(
      LINEAR_BUDGET_MS,
    );
  });

  it.each([
    ["nested images", nestedImages],
    ["many open backtick lengths", manyBacktickLengths],
    ["a link head with a long tail and no closer", linkHeadWithLongTail],
    ["destinations that never close", unclosedDestinations],
    ["titles that never close", unclosedTitles],
    ["tag candidates sharing one closer", tagCandidatesWithOneCloser],
    ["tag attribute candidates", tagAttributeCandidates],
    ["reference label heads", (chars: number) => repeatToLength("[a][", chars)],
    ["short list lines", (chars: number) => repeatToLength("- a\n", chars)],
    ["empty lines", (chars: number) => repeatToLength("\n", chars)],
    ["nested quote lines", (chars: number) => repeatToLength("> > > a\n", chars)],
  ])("stays linear on %s", (_label, generate) => {
    expect(elapsedOnLargeInput(generate)).toBeLessThan(LINEAR_BUDGET_MS);
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

  it("never splits a surrogate pair at the cut", () => {
    const out = truncateText("aaaaaaaa😀x", 10);
    expect(out).toBe("aaaaaaaa…");
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(truncateText("😀😀😀", 2)).toBe("…");
  });
});
