import type { Compare } from "@nojv/core";
import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { runProcess, classifySolutionVerdict } from "./run-process.js";

const DEFAULT_FLOAT_ABS_TOL = 1e-6;
const DEFAULT_FLOAT_REL_TOL = 1e-9;

function normalizeLineEndings(output: string): string {
  return output.replaceAll("\r\n", "\n");
}

function trimTrailingWhitespace(output: string): string {
  return output.replace(/\s+$/, "");
}

function exactMatch(actual: string, expected: string): boolean {
  return trimTrailingWhitespace(actual) === trimTrailingWhitespace(expected);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function applyLineFilter(s: string, patterns: string[]): string {
  if (patterns.length === 0) return s;
  const regexes = patterns.map((p) => new RegExp(p));
  return s
    .split("\n")
    .filter((line) => !regexes.some((r) => r.test(line)))
    .join("\n");
}

function floatMatch(actual: string, expected: string, compare: Compare | undefined): boolean {
  const absTol = compare?.floatAbsTol ?? DEFAULT_FLOAT_ABS_TOL;
  const relTol = compare?.floatRelTol ?? DEFAULT_FLOAT_REL_TOL;
  const aTokens = actual
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const eTokens = expected
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (aTokens.length !== eTokens.length) return false;

  for (let i = 0; i < aTokens.length; i++) {
    const aTok = aTokens[i]!;
    const eTok = eTokens[i]!;
    const an = Number(aTok);
    const en = Number(eTok);
    const bothNumeric = Number.isFinite(an) && Number.isFinite(en);

    if (bothNumeric) {
      const diff = Math.abs(an - en);
      const tolerance = absTol + relTol * Math.max(Math.abs(an), Math.abs(en));
      if (diff > tolerance) return false;
    } else if (aTok !== eTok) {
      return false;
    }
  }

  return true;
}

/**
 * Compare standard-judge output against the expected output, dispatching
 * on the configured compare mode. When no mode is configured, falls back
 * to trimmed exact comparison.
 */
export function compareOutputs(
  actual: string,
  expected: string,
  compare: Compare | undefined
): boolean {
  const a = normalizeLineEndings(actual);
  const e = normalizeLineEndings(expected);
  const mode = compare?.mode ?? "exact";

  switch (mode) {
    case "exact":
      return exactMatch(a, e);
    case "ignore_whitespace":
      return exactMatch(collapseWhitespace(a), collapseWhitespace(e));
    case "ignore_case":
      return exactMatch(a.toLowerCase(), e.toLowerCase());
    case "float":
      return floatMatch(a, e, compare);
    case "regex_filter":
      return exactMatch(
        applyLineFilter(a, compare?.ignoreLinePatterns ?? []),
        applyLineFilter(e, compare?.ignoreLinePatterns ?? [])
      );
  }
}

/**
 * Standard judge: run the program with testcase input as stdin,
 * compare normalized stdout with expected output using the configured
 * compare mode.
 */
export async function judgeStandard(
  runCommand: string[],
  testcase: TestcaseFiles,
  timeoutMs: number,
  compare?: Compare
): Promise<TestcaseResult> {
  const result = await runProcess(runCommand, { stdin: testcase.input, timeoutMs });

  const errorVerdict = classifySolutionVerdict(result, testcase.index);
  if (errorVerdict) return errorVerdict;

  const expected = testcase.expected ?? "";
  const verdict = compareOutputs(result.stdout, expected, compare) ? "AC" : "WA";

  return {
    index: testcase.index,
    verdict,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timeMs: result.timeMs,
    score: verdict === "AC" ? 100 : 0
  };
}
