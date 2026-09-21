import { describe, expect, it } from "vitest";

import { renderEmail } from "@nojv/mailer";

describe("renderEmail", () => {
  it("renders the heading and intro shape without optional sections", () => {
    const html = renderEmail({ heading: "標題", intro: "<p>內文</p>", outro: "尾註" });
    expect(html).toContain("標題</h2>");
    expect(html).toContain("<p>內文</p>");
    expect(html).toContain("尾註");
    expect(html).not.toContain("mso-hide");
    expect(html).not.toContain("text-transform:uppercase");
    expect(html).not.toContain("border-bottom:1px solid");
  });

  it("puts the escaped preheader first and renders eyebrow, meta, body, and action", () => {
    const html = renderEmail({
      preheader: "摘要 <x>",
      eyebrow: "系統公告 · System announcement",
      heading: "重要公告",
      meta: "NOJV · 2026/09/01",
      body: "<p>公告內文</p>",
      action: { url: "https://nojv.tw/?announcement=a1", label: "閱讀完整公告" },
      outro: "尾註",
    });
    expect(html).toContain("摘要 &lt;x&gt;");
    expect(html.indexOf("摘要 &lt;x&gt;")).toBeLessThan(html.indexOf("重要公告"));
    expect(html).toContain("系統公告 · System announcement");
    expect(html).toContain("NOJV · 2026/09/01");
    expect(html).toContain("<p>公告內文</p>");
    expect(html).toContain('href="https://nojv.tw/?announcement=a1"');
    expect(html).toContain("閱讀完整公告");
    expect(html.indexOf("<p>公告內文</p>")).toBeLessThan(html.indexOf("閱讀完整公告"));
  });
});
