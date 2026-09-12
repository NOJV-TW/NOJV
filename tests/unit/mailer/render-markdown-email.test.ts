import { describe, expect, it } from "vitest";

import { renderMarkdownForEmail } from "@nojv/mailer";

const options = { baseUrl: "https://nojv.tw" };

describe("renderMarkdownForEmail", () => {
  it("renders headings, lists, emphasis, and code with inline styles", () => {
    const html = renderMarkdownForEmail(
      "## 重點\n\n- **加粗** 與 `code`\n\n```\nraw < code\n```",
      options,
    );
    expect(html).toContain("重點");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<code style=");
    expect(html).toContain("raw &lt; code");
    expect(html).toMatch(/<ul style="/);
    expect(html).not.toContain("<h2>");
  });

  it("makes relative image and link paths absolute against the app base URL", () => {
    const html = renderMarkdownForEmail(
      "![截圖](/api/storage/user-content-images/u1/a.png)\n\n[設定](/settings)",
      options,
    );
    expect(html).toContain(
      '<img src="https://nojv.tw/api/storage/user-content-images/u1/a.png" alt="截圖"',
    );
    expect(html).toContain('<a href="https://nojv.tw/settings"');
  });

  it("keeps absolute https links and mailto links", () => {
    const html = renderMarkdownForEmail(
      "[site](https://example.com/x?y=1) <mail@example.com>",
      options,
    );
    expect(html).toContain('href="https://example.com/x?y=1"');
    expect(html).toContain('href="mailto:mail@example.com"');
  });

  it("routes third-party images through the NOJV image proxy", () => {
    const html = renderMarkdownForEmail(
      "![a](https://tracker.example/view.png)\n\n![b](//cdn.example.com/b.png)",
      options,
    );
    expect(html).toContain(
      'src="https://nojv.tw/api/images/proxy?url=https%3A%2F%2Ftracker.example%2Fview.png"',
    );
    expect(html).toContain(
      'src="https://nojv.tw/api/images/proxy?url=https%3A%2F%2Fcdn.example.com%2Fb.png"',
    );
    expect(html).not.toContain('src="https://tracker.example');
    expect(html).not.toContain('src="//cdn.example.com');
  });

  it("serves same-origin images directly and drops non-https image sources", () => {
    const html = renderMarkdownForEmail(
      "![a](/api/storage/x.png) ![b](https://nojv.tw/api/storage/y.png) ![c](http://insecure.example/z.png)",
      options,
    );
    expect(html).toContain('src="https://nojv.tw/api/storage/x.png"');
    expect(html).toContain('src="https://nojv.tw/api/storage/y.png"');
    expect(html).not.toContain("images/proxy");
    expect(html).not.toContain("insecure.example");
    expect(html).toContain("c");
  });

  it("drops unsafe link and image protocols but keeps their text", () => {
    const html = renderMarkdownForEmail(
      "[click](javascript:alert(1)) ![alt text](data:image/png;base64,AAAA) [anchor](#top)",
      options,
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img ");
    expect(html).toContain("click");
    expect(html).toContain("alt text");
    expect(html).toContain("anchor");
  });

  it("escapes raw HTML instead of passing it through", () => {
    const html = renderMarkdownForEmail(
      '<script>alert(1)</script>\n\ntext <img src=x onerror="alert(1)"> end',
      options,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("text &lt;img src=x onerror=&quot;alert(1)&quot;&gt; end");
  });

  it("escapes quotes in alt text and titles", () => {
    const html = renderMarkdownForEmail('![a"b](https://x.test/i.png "t\\"t")', options);
    expect(html).toContain('alt="a&quot;b"');
    expect(html).toContain('title="t&quot;t"');
    expect(html).not.toContain('alt="a"b"');
  });

  it("renders tables and task lists without form controls", () => {
    const html = renderMarkdownForEmail(
      "| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo",
      options,
    );
    expect(html).toContain("<th style=");
    expect(html).toContain("text-align:center");
    expect(html).toContain("<td style=");
    expect(html).toContain("☑ done");
    expect(html).toContain("☐ todo");
    expect(html).not.toContain("<input");
  });

  it("converts single newlines to line breaks", () => {
    expect(renderMarkdownForEmail("第一行\n第二行", options)).toContain("第一行<br>第二行");
  });
});
