import { describe, expect, it } from "vitest";

import { renderMarkdown } from "$lib/utils/markdown";

describe("renderMarkdown", () => {
  it("renders KaTeX math with its inline style preserved", () => {
    const html = renderMarkdown("Inline $x^2$ done.");
    expect(html).toContain('class="katex"');
    expect(html).toMatch(/<span[^>]*style="[^"]*height:[^"]*"/);
  });

  it("strips style from untrusted markdown-authored elements", () => {
    const html = renderMarkdown('<p style="color:red">danger</p>');
    expect(html).toContain("<p>danger</p>");
    expect(html).not.toContain("color:red");
    expect(html).not.toMatch(/<p[^>]*style=/);
  });

  it("keeps KaTeX style even when untrusted styled markup is also present", () => {
    const html = renderMarkdown('Math $x^2$\n\n<div style="position:fixed">x</div>');
    expect(html).toMatch(/<span[^>]*style="[^"]*height:[^"]*"/);
    expect(html).not.toContain("position:fixed");
  });

  it("does not expose its internal trust marker or reuse trust between renders", () => {
    const math = renderMarkdown("$x^2$");
    const attacker = renderMarkdown(
      '<span data-katex-nonce="guessed"><span style="position:fixed">x</span></span>',
    );

    expect(math).not.toContain("data-katex-nonce");
    expect(attacker).not.toContain("position:fixed");
    expect(attacker).not.toMatch(/<span[^>]*style=/);
  });
});
