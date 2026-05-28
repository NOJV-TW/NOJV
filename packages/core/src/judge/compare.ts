/**
 * Canonical OJ output normalization:
 *   - CRLF → LF
 *   - per-line trailing whitespace stripped
 *   - trailing blank lines stripped
 */
export function normalizeOutput(s: string): string {
  return s
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Compare standard-judge output against the expected output. Applies the
 * canonical OJ normalization to both sides and tests for exact equality.
 * Float tolerance, case-insensitive matching, and any custom comparison
 * semantics must be implemented as a checker.
 */
export function compareStandard(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}
