export interface CompareOptions {
  caseSensitive?: boolean | undefined;
  floatTolerance?: number | null | undefined;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter((t) => t.length > 0);
}

function tokensMatch(actual: string, expected: string, opts: CompareOptions): boolean {
  const tol = opts.floatTolerance;
  if (tol != null) {
    const na = Number(actual);
    const ne = Number(expected);
    if (Number.isFinite(na) && Number.isFinite(ne)) {
      const diff = Math.abs(na - ne);
      return diff <= tol || diff <= tol * Math.abs(ne);
    }
  }
  if (opts.caseSensitive === false) {
    return actual.toLowerCase() === expected.toLowerCase();
  }
  return actual === expected;
}

export function compareStandard(
  actual: string,
  expected: string,
  opts: CompareOptions = {},
): boolean {
  const actualTokens = tokenize(actual);
  const expectedTokens = tokenize(expected);
  if (actualTokens.length !== expectedTokens.length) return false;
  return actualTokens.every((token, i) => tokensMatch(token, expectedTokens[i] ?? "", opts));
}
