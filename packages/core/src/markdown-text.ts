const BACKTICK_FENCE = "```";
const TILDE_FENCE = "~~~";
const HTML_COMMENT_OPEN = "<!--";
const HTML_COMMENT_CLOSE = "-->";
const REPLACEMENT_CHARACTER = "�";
const MAX_INDENT = 3;
const MAX_HEADING_LEVEL = 6;
const MAX_ORDERED_DIGITS = 9;
const MAX_EMPHASIS_RUN = 3;
const MIN_THEMATIC_BREAK = 3;
const MIN_SETEXT_UNDERLINE = 2;
const MAX_ENTITY_LENGTH = 10;

const KEEP = 0;
const DROP = 1;
const SPACE = 2;
const LITERAL = 3;

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

function isWhitespace(ch: string | undefined): boolean {
  return ch === undefined || ch.trim() === "";
}

function isAsciiLetter(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isAsciiAlphanumeric(ch: string | undefined): boolean {
  return isAsciiLetter(ch) || isAsciiDigit(ch);
}

function isAsciiPunctuation(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isWordCharacter(ch: string | undefined): boolean {
  return ch !== undefined && (isAsciiAlphanumeric(ch) || WORD_CHARACTER.test(ch));
}

function characterAt(line: string, index: number): string | undefined {
  const ch = line[index];
  if (
    ch !== undefined &&
    isHighSurrogate(ch.charCodeAt(0)) &&
    isLowSurrogate(line.charCodeAt(index + 1))
  ) {
    return line.slice(index, index + 2);
  }
  return ch;
}

function characterBefore(line: string, index: number): string | undefined {
  const ch = line[index - 1];
  if (
    ch !== undefined &&
    isLowSurrogate(ch.charCodeAt(0)) &&
    isHighSurrogate(line.charCodeAt(index - 2))
  ) {
    return line.slice(index - 2, index);
  }
  return ch;
}

function skipSpaces(line: string, from: number, max = Number.POSITIVE_INFINITY): number {
  let index = from;
  while (index - from < max && (line[index] === " " || line[index] === "\t")) index++;
  return index;
}

function onlyContains(text: string, allowed: string): boolean {
  for (const ch of text) if (!allowed.includes(ch)) return false;
  return true;
}

function countChar(text: string, target: string): number {
  let count = 0;
  for (const ch of text) if (ch === target) count++;
  return count;
}

function quoteContentStart(line: string, from: number): number {
  let index = skipSpaces(line, from, MAX_INDENT);
  if (line[index] !== ">") return from;
  while (line[index] === ">") index = skipSpaces(line, index + 1);
  return index;
}

function stripQuotePrefix(line: string): string {
  const start = quoteContentStart(line, 0);
  return start === 0 ? line : line.slice(start);
}

function fenceMarker(line: string): string | null {
  const indent = skipSpaces(line, 0, MAX_INDENT);
  if (line.startsWith(BACKTICK_FENCE, indent)) {
    return line.includes(BACKTICK_FENCE, indent + BACKTICK_FENCE.length)
      ? null
      : BACKTICK_FENCE;
  }
  return line.startsWith(TILDE_FENCE, indent) ? TILDE_FENCE : null;
}

function isThematicBreak(line: string): boolean {
  const trimmed = line.trim();
  const marker = trimmed[0];
  if (marker !== "-" && marker !== "*" && marker !== "_") return false;
  if (!onlyContains(trimmed, `${marker} \t`)) return false;
  return countChar(trimmed, marker) >= MIN_THEMATIC_BREAK;
}

function isSetextUnderline(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < MIN_SETEXT_UNDERLINE) return false;
  return onlyContains(trimmed, "=") || onlyContains(trimmed, "-");
}

function isTableDivider(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("-") && trimmed.includes("|") && onlyContains(trimmed, "|:- \t");
}

function isLinkDefinition(line: string): boolean {
  const start = skipSpaces(line, 0, MAX_INDENT);
  if (line[start] !== "[") return false;
  const close = line.indexOf("]:", start + 1);
  if (close === -1 || close === start + 1) return false;
  const destination = skipSpaces(line, close + 2);
  return destination < line.length && !isWhitespace(line[destination]);
}

function listMarkerEnd(line: string, index: number): number {
  const ch = line[index];
  let end = -1;
  if (ch === "-" || ch === "*" || ch === "+") {
    end = index + 1;
  } else if (isAsciiDigit(ch)) {
    let cursor = index;
    while (cursor - index < MAX_ORDERED_DIGITS && isAsciiDigit(line[cursor])) cursor++;
    if (line[cursor] === "." || line[cursor] === ")") end = cursor + 1;
  }
  if (end === -1 || !isWhitespace(line[end])) return -1;
  return skipSpaces(line, end);
}

function taskBoxEnd(line: string, index: number): number {
  const state = line[index + 1];
  if (
    line[index] === "[" &&
    (state === " " || state === "x" || state === "X") &&
    line[index + 2] === "]" &&
    isWhitespace(line[index + 3])
  ) {
    return skipSpaces(line, index + 3);
  }
  return index;
}

function headingContent(line: string, from: number): string | null {
  const index = skipSpaces(line, from, MAX_INDENT);
  if (line[index] !== "#") return null;
  let end = index;
  while (line[end] === "#") end++;
  if (end - index > MAX_HEADING_LEVEL || !isWhitespace(line[end])) return null;
  let close = line.length;
  while (close > end && isWhitespace(line[close - 1])) close--;
  while (close > end && line[close - 1] === "#") close--;
  if (close < line.length && close > end && !isWhitespace(line[close - 1])) close = line.length;
  return line.slice(skipSpaces(line, end), close);
}

interface BlockLine {
  content: string;
  startsBlock: boolean;
  heading: boolean;
}

function stripBlockPrefix(line: string): BlockLine {
  let start = 0;
  let startsBlock = false;
  for (;;) {
    const heading = headingContent(line, start);
    if (heading !== null) return { content: heading, startsBlock: true, heading: true };
    const afterMarker = listMarkerEnd(line, skipSpaces(line, start));
    if (afterMarker === -1) {
      const content = line.slice(skipSpaces(line, start, MAX_INDENT));
      return { content, startsBlock: startsBlock || content.startsWith("|"), heading: false };
    }
    startsBlock = true;
    start = quoteContentStart(line, taskBoxEnd(line, afterMarker));
  }
}

function indexOfUnmasked(line: string, mask: Uint8Array, needle: string, from: number): number {
  let cursor = from;
  while (cursor < line.length) {
    const found = line.indexOf(needle, cursor);
    if (found === -1) return -1;
    if (mask[found] === KEEP) return found;
    cursor = found + 1;
    while (cursor < line.length && mask[cursor] !== KEEP) cursor++;
  }
  return -1;
}

type Finder = (from: number) => number;

function monotoneFinder(
  line: string,
  mask: Uint8Array,
  matches: (ch: string) => boolean,
): Finder {
  let cached = -1;
  let exhausted = false;
  return (from) => {
    if (exhausted) return -1;
    if (cached >= from) return cached;
    let index = from;
    while (index < line.length && !(mask[index] === KEEP && matches(line[index] ?? "")))
      index++;
    if (index >= line.length) {
      exhausted = true;
      return -1;
    }
    cached = index;
    return index;
  };
}

function fillRanges(mask: Uint8Array, flag: number, ranges: number[]): void {
  let watermark = mask.length;
  for (let index = ranges.length - 2; index >= 0; index -= 2) {
    const from = ranges[index] ?? 0;
    const to = ranges[index + 1] ?? 0;
    if (from >= watermark) continue;
    mask.fill(flag, from, Math.min(to, watermark));
    watermark = from;
  }
}

function precedingBackslashes(line: string, index: number): number {
  let count = 0;
  while (line[index - 1 - count] === "\\") count++;
  return count;
}

function markCodeSpans(line: string, mask: Uint8Array): void {
  const openers = new Map<number, number>();
  const openLengths: number[] = [];
  const delimiters: number[] = [];
  const contents: number[] = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`" || mask[index] !== KEEP) {
      index++;
      continue;
    }
    let end = index;
    while (line[end] === "`" && mask[end] === KEEP) end++;
    const length = end - index;
    const opener = openers.get(length) ?? -1;
    if (opener < 0) {
      if (precedingBackslashes(line, index) % 2 === 1) {
        index++;
        continue;
      }
      openers.set(length, index);
      openLengths.push(length);
    } else {
      delimiters.push(opener, opener + length, index, end);
      contents.push(opener + length, index);
      while (openLengths.length > 0) {
        const top = openLengths[openLengths.length - 1] ?? 0;
        if ((openers.get(top) ?? -1) < opener) break;
        openLengths.pop();
        openers.set(top, -1);
      }
    }
    index = end;
  }
  fillRanges(mask, LITERAL, contents);
  for (let cursor = 0; cursor < delimiters.length; cursor += 2) {
    mask.fill(DROP, delimiters[cursor] ?? 0, delimiters[cursor + 1] ?? 0);
  }
}

function markEscapes(line: string, mask: Uint8Array): void {
  let index = 0;
  while (index < line.length) {
    if (line[index] === "\\" && mask[index] === KEEP && isAsciiPunctuation(line[index + 1])) {
      if (mask[index + 1] === KEEP) {
        mask[index] = DROP;
        mask[index + 1] = LITERAL;
      }
      index += 2;
      continue;
    }
    index++;
  }
}

interface LinkScanner {
  closerAt: Int32Array;
  openParenBefore: Int32Array;
  nextWhitespace: Finder;
  nextNonWhitespace: Finder;
  nextDoubleQuote: Finder;
  nextSingleQuote: Finder;
  nextAngleClose: Finder;
  nextAngleOpenOrBreak: Finder;
  nextBracketClose: Finder;
  nextBracketOpen: Finder;
}

function createLinkScanner(line: string, mask: Uint8Array): LinkScanner {
  const closerAt = new Int32Array(line.length);
  const openParenBefore = new Int32Array(line.length);
  const stack: number[] = [];
  for (let index = line.length - 1; index >= 0; index--) {
    if (mask[index] === KEEP) {
      if (line[index] === ")") stack.push(index);
      else if (line[index] === "(" && stack.length > 0) stack.pop();
    }
    closerAt[index] = stack.length > 0 ? (stack[stack.length - 1] ?? -1) : -1;
  }
  stack.length = 0;
  for (let index = 0; index < line.length; index++) {
    openParenBefore[index] = stack.length > 0 ? (stack[stack.length - 1] ?? -1) : -1;
    if (mask[index] === KEEP) {
      if (line[index] === "(") stack.push(index);
      else if (line[index] === ")" && stack.length > 0) stack.pop();
    }
  }
  return {
    closerAt,
    openParenBefore,
    nextWhitespace: monotoneFinder(line, mask, (ch) => isWhitespace(ch)),
    nextNonWhitespace: monotoneFinder(line, mask, (ch) => !isWhitespace(ch)),
    nextDoubleQuote: monotoneFinder(line, mask, (ch) => ch === '"'),
    nextSingleQuote: monotoneFinder(line, mask, (ch) => ch === "'"),
    nextAngleClose: monotoneFinder(line, mask, (ch) => ch === ">"),
    nextAngleOpenOrBreak: monotoneFinder(line, mask, (ch) => ch === "<" || ch === "\n"),
    nextBracketClose: monotoneFinder(line, mask, (ch) => ch === "]"),
    nextBracketOpen: monotoneFinder(line, mask, (ch) => ch === "["),
  };
}

function linkDestinationEnd(
  line: string,
  mask: Uint8Array,
  scanner: LinkScanner,
  from: number,
): number {
  let cursor: number;
  if (line[from] === "<" && mask[from] === KEEP) {
    const close = scanner.nextAngleClose(from + 1);
    if (close === -1) return -1;
    const invalid = scanner.nextAngleOpenOrBreak(from + 1);
    if (invalid !== -1 && invalid < close) return -1;
    cursor = close + 1;
  } else {
    const closer = scanner.closerAt[from] ?? -1;
    const whitespace = scanner.nextWhitespace(from);
    if (whitespace === -1 || (closer !== -1 && whitespace > closer)) return closer;
    if ((scanner.openParenBefore[whitespace] ?? -1) >= from) return -1;
    cursor = whitespace;
  }
  const titleStart = scanner.nextNonWhitespace(cursor);
  if (titleStart === -1) return -1;
  const quote = line[titleStart];
  if (quote === ")") return titleStart;
  if (quote !== '"' && quote !== "'") return -1;
  const finder = quote === '"' ? scanner.nextDoubleQuote : scanner.nextSingleQuote;
  const titleEnd = finder(titleStart + 1);
  if (titleEnd === -1) return -1;
  const close = scanner.nextNonWhitespace(titleEnd + 1);
  return close !== -1 && line[close] === ")" ? close : -1;
}

function referenceLabelEnd(line: string, scanner: LinkScanner, from: number): number {
  const close = scanner.nextBracketClose(from);
  if (close === -1) return -1;
  const open = scanner.nextBracketOpen(from);
  return open !== -1 && open < close ? -1 : close;
}

function markLinks(line: string, mask: Uint8Array): void {
  if (!line.includes("](") && !line.includes("][")) return;
  const scanner = createLinkScanner(line, mask);
  const openers: { position: number; image: boolean }[] = [];
  const imageRanges: number[] = [];
  let index = 0;
  while (index < line.length) {
    const ch = line[index];
    if (mask[index] !== KEEP || (ch !== "[" && ch !== "]")) {
      index++;
      continue;
    }
    if (ch === "[") {
      const image = line[index - 1] === "!" && mask[index - 1] === KEEP;
      openers.push({ position: index, image });
      index++;
      continue;
    }
    const opener = openers.pop();
    const next = line[index + 1];
    let end = -1;
    if (opener !== undefined && mask[index + 1] === KEEP) {
      if (next === "(") end = linkDestinationEnd(line, mask, scanner, index + 2);
      else if (next === "[") end = referenceLabelEnd(line, scanner, index + 2);
    }
    if (opener === undefined || end === -1) {
      index++;
      continue;
    }
    if (opener.image) {
      imageRanges.push(opener.position - 1, end + 1);
    } else {
      mask[opener.position] = DROP;
      mask.fill(DROP, index, end + 1);
    }
    index = end + 1;
  }
  fillRanges(mask, DROP, imageRanges);
}

function isAutolink(inner: string): boolean {
  if (inner.length === 0 || inner.includes("<")) return false;
  let colon = -1;
  let at = -1;
  for (let index = 0; index < inner.length; index++) {
    const ch = inner[index] ?? "";
    if (isWhitespace(ch)) return false;
    if (ch === ":" && colon === -1) colon = index;
    if (ch === "@" && at === -1) at = index;
  }
  if (colon >= 2) {
    const scheme = inner.slice(0, colon);
    if (!isAsciiLetter(scheme[0])) return false;
    for (const ch of scheme) {
      if (!isAsciiAlphanumeric(ch) && ch !== "+" && ch !== "." && ch !== "-") return false;
    }
    return true;
  }
  return at > 0 && at < inner.length - 1 && colon === -1;
}

function isTagNameChar(ch: string | undefined): boolean {
  return isAsciiAlphanumeric(ch) || ch === "-";
}

function isAttributeStartChar(ch: string | undefined): boolean {
  return isAsciiLetter(ch) || ch === "_" || ch === ":";
}

function isAttributeNameChar(ch: string | undefined): boolean {
  return isAsciiAlphanumeric(ch) || ch === "_" || ch === "." || ch === ":" || ch === "-";
}

function isUnquotedValueChar(ch: string | undefined): boolean {
  return ch !== undefined && !isWhitespace(ch) && !"\"'=<>`".includes(ch);
}

function htmlTagEnd(line: string, mask: Uint8Array, from: number): number {
  const keep = (index: number) => index < line.length && mask[index] === KEEP;
  const skipWhitespace = (start: number) => {
    let index = start;
    while (keep(index) && isWhitespace(line[index])) index++;
    return index;
  };
  let index = from;
  const closing = line[index] === "/";
  if (closing) index++;
  if (!keep(index) || !isAsciiLetter(line[index])) return -1;
  while (keep(index) && isTagNameChar(line[index])) index++;
  if (closing) {
    index = skipWhitespace(index);
    return keep(index) && line[index] === ">" ? index : -1;
  }
  for (;;) {
    const afterWhitespace = skipWhitespace(index);
    if (keep(afterWhitespace) && line[afterWhitespace] === ">") return afterWhitespace;
    if (keep(afterWhitespace) && line[afterWhitespace] === "/") {
      return keep(afterWhitespace + 1) && line[afterWhitespace + 1] === ">"
        ? afterWhitespace + 1
        : -1;
    }
    if (afterWhitespace === index || !keep(afterWhitespace)) return -1;
    if (!isAttributeStartChar(line[afterWhitespace])) return -1;
    index = afterWhitespace + 1;
    while (keep(index) && isAttributeNameChar(line[index])) index++;
    const equals = skipWhitespace(index);
    if (!keep(equals) || line[equals] !== "=") continue;
    index = skipWhitespace(equals + 1);
    const quote = line[index];
    if (keep(index) && (quote === '"' || quote === "'")) {
      index++;
      while (keep(index) && line[index] !== quote) index++;
      if (!keep(index)) return -1;
      index++;
    } else {
      const start = index;
      while (keep(index) && isUnquotedValueChar(line[index])) index++;
      if (index === start) return -1;
    }
  }
}

function markHtml(line: string, mask: Uint8Array): void {
  let commentExhausted = false;
  let cachedClose = -1;
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "<" || mask[index] !== KEEP) {
      index++;
      continue;
    }
    if (!commentExhausted && line.startsWith(HTML_COMMENT_OPEN, index)) {
      const close = indexOfUnmasked(
        line,
        mask,
        HTML_COMMENT_CLOSE,
        index + HTML_COMMENT_OPEN.length,
      );
      if (close === -1) {
        commentExhausted = true;
      } else {
        const end = close + HTML_COMMENT_CLOSE.length;
        mask.fill(SPACE, index, end);
        index = end;
        continue;
      }
    }
    const next = line[index + 1];
    if (!(isAsciiLetter(next) || next === "/")) {
      index++;
      continue;
    }
    if (cachedClose <= index) cachedClose = indexOfUnmasked(line, mask, ">", index + 1);
    if (cachedClose === -1) return;
    if (isAutolink(line.slice(index + 1, cachedClose))) {
      mask[index] = DROP;
      mask.fill(LITERAL, index + 1, cachedClose);
      mask[cachedClose] = DROP;
      index = cachedClose + 1;
      continue;
    }
    const end = htmlTagEnd(line, mask, index + 1);
    if (end === -1) {
      index++;
      continue;
    }
    mask.fill(SPACE, index, end + 1);
    index = end + 1;
  }
}

function markEmphasis(line: string, mask: Uint8Array): void {
  const openers = new Map<string, number[]>();
  let index = 0;
  while (index < line.length) {
    const ch = line[index];
    if ((ch !== "*" && ch !== "_" && ch !== "~") || mask[index] !== KEEP) {
      index++;
      continue;
    }
    let end = index;
    while (line[end] === ch && mask[end] === KEEP) end++;
    const length = end - index;
    const usable = ch === "~" ? length === 2 : length <= MAX_EMPHASIS_RUN;
    if (usable) {
      const before = characterBefore(line, index);
      const after = characterAt(line, end);
      const canOpen = !isWhitespace(after) && (ch !== "_" || !isWordCharacter(before));
      const canClose = !isWhitespace(before) && (ch !== "_" || !isWordCharacter(after));
      const key = `${ch}${String(length)}`;
      const stack = openers.get(key) ?? [];
      const opener = canClose ? stack.pop() : undefined;
      if (opener !== undefined) {
        mask.fill(DROP, opener, opener + length);
        mask.fill(DROP, index, end);
      } else if (canOpen) {
        stack.push(index);
      }
      openers.set(key, stack);
    }
    index = end;
  }
}

function decodeEntity(line: string, mask: Uint8Array, index: number): [string, number] | null {
  const limit = Math.min(line.length, index + MAX_ENTITY_LENGTH);
  let end = index + 1;
  while (end < limit && line[end] !== ";" && mask[end] === KEEP) end++;
  if (line[end] !== ";" || mask[end] !== KEEP) return null;
  const body = line.slice(index + 1, end);
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const digits = body.slice(hex ? 2 : 1);
    if (digits.length === 0) return null;
    for (const ch of digits) {
      const valid = hex ? isAsciiDigit(ch) || "abcdefABCDEF".includes(ch) : isAsciiDigit(ch);
      if (!valid) return null;
    }
    const code = Number.parseInt(digits, hex ? 16 : 10);
    const invalid =
      !Number.isFinite(code) ||
      code === 0 ||
      code > 0x10ffff ||
      isHighSurrogate(code) ||
      isLowSurrogate(code);
    return [invalid ? REPLACEMENT_CHARACTER : String.fromCodePoint(code), end + 1];
  }
  const named = NAMED_ENTITIES.get(body);
  return named === undefined ? null : [named, end + 1];
}

function emitLine(line: string, mask: Uint8Array): string {
  let text = "";
  let index = 0;
  while (index < line.length) {
    const flag = mask[index];
    const ch = line[index] ?? "";
    if (flag === DROP) {
      index++;
    } else if (flag === SPACE) {
      text += " ";
      index++;
    } else if (flag === LITERAL) {
      text += ch;
      index++;
    } else if (ch === "|") {
      text += " ";
      index++;
    } else if (ch === "&") {
      const decoded = decodeEntity(line, mask, index);
      if (decoded === null) {
        text += ch;
        index++;
      } else {
        text += decoded[0];
        index = decoded[1];
      }
    } else {
      if (ch !== "`") text += ch;
      index++;
    }
  }
  return text;
}

function collapseWhitespace(text: string): string {
  let result = "";
  let pendingSpace = false;
  for (const ch of text) {
    if (isWhitespace(ch)) {
      pendingSpace = result.length > 0;
      continue;
    }
    if (pendingSpace) result += " ";
    pendingSpace = false;
    result += ch;
  }
  return result;
}

function inlineToPlainText(line: string): string {
  const mask = new Uint8Array(line.length);
  markCodeSpans(line, mask);
  markEscapes(line, mask);
  markLinks(line, mask);
  markHtml(line, mask);
  markEmphasis(line, mask);
  return emitLine(line, mask);
}

export function markdownToPlainText(markdown: string): string {
  const parts: string[] = [];
  const paragraph: string[] = [];
  let paragraphIsPlain = false;
  let fence: string | null = null;
  let fenceQuoted = false;
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(inlineToPlainText(paragraph.join("\n")));
    paragraph.length = 0;
  };
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const quoted = stripQuotePrefix(line);
    if (fence !== null) {
      const body = fenceQuoted ? quoted : line;
      if (fenceMarker(body) === fence) {
        fence = null;
      } else {
        parts.push(body);
      }
      continue;
    }
    const opening = fenceMarker(quoted);
    if (opening !== null) {
      flushParagraph();
      fence = opening;
      fenceQuoted = quoted !== line;
      continue;
    }
    if (
      isThematicBreak(quoted) ||
      isTableDivider(quoted) ||
      isLinkDefinition(quoted) ||
      (paragraph.length > 0 && paragraphIsPlain && isSetextUnderline(quoted))
    ) {
      flushParagraph();
      continue;
    }
    const block = stripBlockPrefix(quoted);
    if (block.content.trim() === "") {
      flushParagraph();
      continue;
    }
    if (block.startsBlock) flushParagraph();
    if (paragraph.length === 0) paragraphIsPlain = !block.startsBlock;
    paragraph.push(block.content);
    if (block.heading) flushParagraph();
  }
  flushParagraph();
  return collapseWhitespace(parts.join(" "));
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let cut = Math.max(0, maxLength - 1);
  if (cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1))) cut--;
  return `${text.slice(0, cut).trimEnd()}…`;
}
