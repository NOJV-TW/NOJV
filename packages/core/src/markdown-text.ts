const CODE_FENCE = "```";
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const HEADING = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE = /^\s{0,3}>\s?/gm;
const HORIZONTAL_RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gm;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm;
const INLINE_CODE = /`+([^`]*)`+/g;
const STAR_EMPHASIS = /(\*{1,3}|~~)(\S[^*~\n]*?\S|\S)\1/g;
const UNDERSCORE_EMPHASIS = /(?<![A-Za-z0-9])(_{1,3})(\S[^_\n]*?\S|\S)\1(?![A-Za-z0-9])/g;
const WHITESPACE = /\s+/g;

function stripCodeFences(markdown: string): string {
  if (!markdown.includes(CODE_FENCE)) return markdown;
  const segments = markdown.split(CODE_FENCE);
  let text = segments[0] ?? "";
  for (let index = 1; index < segments.length; index += 2) {
    const block = segments[index] ?? "";
    const infoEnd = block.indexOf("\n");
    const body = infoEnd === -1 ? block : block.slice(infoEnd + 1);
    text += ` ${body} ${segments[index + 1] ?? ""}`;
  }
  return text;
}

export function markdownToPlainText(markdown: string): string {
  return stripCodeFences(markdown)
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .replace(HTML_TAG, " ")
    .replace(HEADING, "")
    .replace(BLOCKQUOTE, "")
    .replace(HORIZONTAL_RULE, " ")
    .replace(TABLE_DIVIDER, " ")
    .replace(LIST_MARKER, "")
    .replace(INLINE_CODE, "$1")
    .replace(STAR_EMPHASIS, "$2")
    .replace(UNDERSCORE_EMPHASIS, "$2")
    .replace(/\|/g, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
