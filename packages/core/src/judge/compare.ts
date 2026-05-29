export function normalizeOutput(s: string): string {
  return s
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

export function compareStandard(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}
