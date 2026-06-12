import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import MarkdownRenderer from "../../../apps/web/src/lib/components/primitives/layout/MarkdownRenderer.svelte";

const URL_ATTRIBUTES = new Set(["href", "src", "xlink:href"]);
const DANGEROUS_URL_SCHEMES = new Set(["javascript", "data", "vbscript"]);

function parseUrlScheme(value: string): string | null {
  return /^([a-z][a-z\d+.-]*):/i.exec(value.trim())?.[1]?.toLowerCase() ?? null;
}

function dangerousAttributes(root: ParentNode): string[] {
  const found: string[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const scheme = parseUrlScheme(attr.value);
      const isDangerousUrl =
        URL_ATTRIBUTES.has(name) && scheme !== null && DANGEROUS_URL_SCHEMES.has(scheme);

      if (name.startsWith("on") || isDangerousUrl) {
        found.push(`${el.tagName.toLowerCase()}[${attr.name}="${attr.value}"]`);
      }
    }
  }
  return found;
}

describe("MarkdownRenderer editorial XSS handling", () => {
  it("renders editorial markdown without executable nodes or attributes", () => {
    const rendered = render(MarkdownRenderer, {
      props: {
        content: [
          "# Safe editorial",
          "The normal explanation survives.",
          '<img src="x" onerror="window.__nojvXss = true">',
          "<script>window.__nojvXss = true</script>",
          '<a href="javascript:window.__nojvXss = true">bad link</a>',
          '<a href="data:text/html,<script>window.__nojvXss = true</script>">data link</a>',
          '<a href="vbscript:msgbox(1)">vbscript link</a>',
        ].join("\n\n"),
      },
    });
    const dom = new JSDOM(`<section>${rendered.body}</section>`);
    const target = dom.window.document.querySelector("section");
    if (!target) {
      throw new Error("MarkdownRenderer did not produce a section wrapper.");
    }

    expect(target.textContent).toContain("Safe editorial");
    expect(target.textContent).toContain("The normal explanation survives.");
    expect(target.querySelector("script")).toBeNull();
    expect(dangerousAttributes(target)).toEqual([]);
  });
});
