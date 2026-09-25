const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE = new RegExp(
  `${ESC}(?:\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)|\\[[0-?]*[ -/]*[@-~])`,
  "g",
);
const INTERNAL_TRACEBACK_FRAME = /^\s*File "(?:<frozen [^"]+>|[^"]*(?:\/|\\)\.forge(?:\/|\\))/;
const TRACEBACK_MARKER = /^\s*[\^~]+$/;

export function formatJudgeOutput(value: string): string {
  const lines = value.replace(ANSI_ESCAPE, "").replace(/\r\n?/g, "\n").split("\n");
  const visibleLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (INTERNAL_TRACEBACK_FRAME.test(lines[index] ?? "")) {
      index += 1;
      continue;
    }
    if (TRACEBACK_MARKER.test(lines[index] ?? "")) continue;
    visibleLines.push((lines[index] ?? "").replaceAll("/project/", ""));
  }

  return visibleLines.join("\n").trim();
}

export function formatMemoryKb(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${String(kb)} KB`;
}
