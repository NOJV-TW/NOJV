import { Marked, type RendererObject, type Tokens } from "marked";

import { escapeHtml } from "./html";
import {
  BACKGROUND,
  BORDER,
  BORDER_SUBTLE,
  FOREGROUND,
  MONO_FONT,
  MUTED_FOREGROUND,
  PRIMARY,
} from "./theme";

export interface EmailMarkdownOptions {
  baseUrl: string;
}

const PARAGRAPH_STYLE = "margin:0 0 12px;line-height:1.7";
const CODE_STYLE = `padding:1px 5px;border-radius:4px;background-color:${BACKGROUND};font-family:${MONO_FONT};font-size:0.9em`;
const PRE_STYLE = `margin:0 0 12px;padding:12px 14px;border-radius:10px;background-color:${BACKGROUND};overflow-x:auto;font-family:${MONO_FONT};font-size:13px;line-height:1.6`;
const CELL_STYLE = `padding:6px 10px;border:1px solid ${BORDER};text-align:left;vertical-align:top`;

const IMAGE_PROXY_PATH = "/api/images/proxy?url=";

function proxiedImageUrl(url: URL, baseUrl: string): string | null {
  if (url.protocol !== "https:") return null;
  url.hash = "";
  return `${new URL(IMAGE_PROXY_PATH, baseUrl).href}${encodeURIComponent(url.href)}`;
}

function resolveEmailUrl(raw: string, baseUrl: string, kind: "link" | "image"): string | null {
  const value = raw.trim();
  if (value === "") return null;
  if (value.startsWith("//")) {
    return kind === "image" ? proxiedImageUrl(new URL(`https:${value}`), baseUrl) : null;
  }
  if (value.startsWith("/")) return new URL(value, baseUrl).href;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (kind === "image") {
    return url.origin === new URL(baseUrl).origin ? url.href : proxiedImageUrl(url, baseUrl);
  }
  if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  return url.protocol === "mailto:" ? url.href : null;
}

function headingSize(depth: number): number {
  if (depth <= 1) return 19;
  if (depth === 2) return 17;
  return 15;
}

function tableCell(cell: Tokens.TableCell, content: string): string {
  const tag = cell.header ? "th" : "td";
  const align = cell.align ? `;text-align:${cell.align}` : "";
  const weight = cell.header ? `;font-weight:600;background-color:${BACKGROUND}` : "";
  return `<${tag} style="${CELL_STYLE}${align}${weight}">${content}</${tag}>`;
}

function createRenderer(baseUrl: string): RendererObject {
  return {
    space: () => "",
    def: () => "",
    hr: () => `<hr style="margin:20px 0;border:0;border-top:1px solid ${BORDER_SUBTLE}">`,
    heading({ tokens, depth }) {
      return `<p style="margin:18px 0 8px;font-size:${String(headingSize(depth))}px;font-weight:700;line-height:1.4;color:${FOREGROUND}">${this.parser.parseInline(tokens)}</p>`;
    },
    paragraph({ tokens }) {
      return `<p style="${PARAGRAPH_STYLE}">${this.parser.parseInline(tokens)}</p>`;
    },
    blockquote({ tokens }) {
      return `<blockquote style="margin:0 0 12px;padding:2px 0 2px 14px;border-left:3px solid ${BORDER};color:${MUTED_FOREGROUND}">${this.parser.parse(tokens)}</blockquote>`;
    },
    code({ text }) {
      return `<pre style="${PRE_STYLE}"><code style="font-family:${MONO_FONT}">${escapeHtml(text)}</code></pre>`;
    },
    codespan({ text }) {
      return `<code style="${CODE_STYLE}">${escapeHtml(text)}</code>`;
    },
    html(token) {
      const text = escapeHtml(token.text);
      return token.block ? `<p style="${PARAGRAPH_STYLE}">${text}</p>` : text;
    },
    list(token) {
      const tag = token.ordered ? "ol" : "ul";
      const start =
        token.ordered && token.start !== "" && token.start !== 1
          ? ` start="${String(token.start)}"`
          : "";
      const items = token.items.map((item) => this.listitem(item)).join("");
      return `<${tag}${start} style="margin:0 0 12px;padding-left:24px">${items}</${tag}>`;
    },
    listitem(item) {
      return `<li style="margin:4px 0;line-height:1.7">${this.parser.parse(item.tokens)}</li>`;
    },
    checkbox({ checked }) {
      return checked ? "☑ " : "☐ ";
    },
    table(token) {
      const header = token.header
        .map((cell) => tableCell(cell, this.parser.parseInline(cell.tokens)))
        .join("");
      const rows = token.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => tableCell(cell, this.parser.parseInline(cell.tokens))).join("")}</tr>`,
        )
        .join("");
      return `<table style="margin:0 0 12px;border-collapse:collapse;width:100%;font-size:14px"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    },
    strong({ tokens }) {
      return `<strong>${this.parser.parseInline(tokens)}</strong>`;
    },
    em({ tokens }) {
      return `<em>${this.parser.parseInline(tokens)}</em>`;
    },
    del({ tokens }) {
      return `<s>${this.parser.parseInline(tokens)}</s>`;
    },
    br: () => "<br>",
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const url = resolveEmailUrl(href, baseUrl, "link");
      if (url === null) return text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(url)}"${titleAttr} style="color:${PRIMARY};text-decoration:underline">${text}</a>`;
    },
    image({ href, title, text }) {
      const url = resolveEmailUrl(href, baseUrl, "image");
      if (url === null) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titleAttr} style="display:block;max-width:100%;height:auto;margin:12px 0;border-radius:12px">`;
    },
    text(token) {
      if (token.type === "text" && token.tokens) return this.parser.parseInline(token.tokens);
      return escapeHtml(token.text);
    },
  };
}

export function renderMarkdownForEmail(
  markdown: string,
  options: EmailMarkdownOptions,
): string {
  const parser = new Marked({
    gfm: true,
    breaks: true,
    renderer: createRenderer(options.baseUrl),
  });
  return parser.parse(markdown, { async: false }).trim();
}
