import { describe, expect, it } from "vitest";

import { renderMarkdown } from "$lib/utils/markdown";

describe("renderMarkdown", () => {
  it("proxies remote image sources without changing first-party or inline images", () => {
    const html = renderMarkdown(
      [
        "![remote](https://images.example/cat.png?size=2)",
        "![protocol-relative](//cdn.example/dog.webp)",
        "![local](/api/storage/user-content-images/u/image.png)",
        "![inline](data:image/png;base64,AAAA)",
      ].join("\n\n"),
    );

    expect(html).toContain(
      `/api/images/proxy?url=${encodeURIComponent("https://images.example/cat.png?size=2")}`,
    );
    expect(html).toContain(
      `/api/images/proxy?url=${encodeURIComponent("https://cdn.example/dog.webp")}`,
    );
    expect(html).toContain('src="/api/storage/user-content-images/u/image.png"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain('src="https://images.example');
    expect(html).not.toContain('src="//cdn.example');
  });

  it("removes insecure remote image sources and srcset bypasses", () => {
    const html = renderMarkdown(
      '<img src="http://images.example/insecure.png" srcset="https://images.example/2x.png 2x" alt="safe alt">',
    );

    expect(html).toContain('alt="safe alt"');
    expect(html).not.toContain("http://images.example");
    expect(html).not.toContain("https://images.example");
    expect(html).not.toContain("srcset");
  });

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
