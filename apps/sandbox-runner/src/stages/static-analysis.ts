import * as fs from "node:fs/promises";
import type { StaticAnalysisConfig, StaticAnalysisResult, StaticAnalysisViolation } from "@nojv/core";
import { runProcess } from "../judges/run-process.js";

/**
 * Run static analysis on the user's source code.
 *
 * Checks for:
 * 1. Banned function calls (simple identifier matching)
 * 2. Banned imports/includes
 * 3. Banned patterns (string or regex)
 * 4. Optional external linter command
 */
export async function runStaticAnalysis(
  sourcePath: string,
  config: StaticAnalysisConfig
): Promise<StaticAnalysisResult> {
  const source = await fs.readFile(sourcePath, "utf-8");
  const lines = source.split("\n");
  const violations: StaticAnalysisViolation[] = [];

  // 1. Check banned functions
  for (const func of config.bannedFunctions) {
    // Match function calls: identifier followed by ( — avoids partial matches
    // Uses word boundary to avoid matching substrings (e.g. "sort" in "sorted")
    const pattern = new RegExp(`\\b${escapeRegex(func)}\\s*\\(`, "g");
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i]!)) continue;
      if (pattern.test(lines[i]!)) {
        violations.push({
          line: i + 1,
          rule: "banned-function",
          message: `Use of banned function '${func}' is not allowed.`,
          severity: "error"
        });
      }
      pattern.lastIndex = 0;
    }
  }

  // 2. Check banned imports
  for (const imp of config.bannedImports) {
    const importPatterns = [
      new RegExp(`#include\\s*[<"]${escapeRegex(imp)}[>"]`),      // C/C++
      new RegExp(`\\bimport\\s+${escapeRegex(imp)}\\b`),           // Python/Java/Go
      new RegExp(`\\bfrom\\s+${escapeRegex(imp)}\\b`),             // Python
      new RegExp(`\\brequire\\s*\\(\\s*['"]${escapeRegex(imp)}['"]`), // JS/TS
      new RegExp(`\\bimport\\s+.*['"]${escapeRegex(imp)}['"]`)     // JS/TS ES modules
    ];

    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i]!)) continue;
      for (const pat of importPatterns) {
        if (pat.test(lines[i]!)) {
          violations.push({
            line: i + 1,
            rule: "banned-import",
            message: `Import of '${imp}' is not allowed.`,
            severity: "error"
          });
          break;
        }
      }
    }
  }

  // 3. Check banned patterns (string or regex)
  for (const bp of config.bannedPatterns) {
    const pattern = bp.isRegex
      ? safeRegex(bp.pattern)
      : new RegExp(escapeRegex(bp.pattern), "g");

    if (!pattern) {
      violations.push({
        rule: "invalid-pattern",
        message: `Invalid regex pattern: ${bp.pattern}`,
        severity: "warning"
      });
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i]!)) continue;
      if (pattern.test(lines[i]!)) {
        violations.push({
          line: i + 1,
          rule: "banned-pattern",
          message: bp.message,
          severity: "error"
        });
      }
      pattern.lastIndex = 0;
    }
  }

  // 4. Run external linter if configured
  if (config.linterCommand && config.linterCommand.length > 0) {
    const linterViolations = await runLinter(config.linterCommand, sourcePath);
    violations.push(...linterViolations);
  }

  const hasErrors = violations.some((v) => v.severity === "error");

  return {
    passed: !hasErrors,
    violations
  };
}

/** Run an external linter command and parse output for violations. */
async function runLinter(
  command: string[],
  sourcePath: string
): Promise<StaticAnalysisViolation[]> {
  const LINTER_TIMEOUT_MS = 30_000;
  const fullCommand = command.map((arg) => arg.replace("{{SOURCE}}", sourcePath));

  const result = await runProcess(fullCommand, { timeoutMs: LINTER_TIMEOUT_MS });

  if (result.spawnError) {
    return [
      {
        rule: "linter-error",
        message: `Linter failed to start: ${result.stderr}`,
        severity: "warning"
      }
    ];
  }

  if (result.timedOut) {
    return [
      {
        rule: "linter-timeout",
        message: "Linter timed out.",
        severity: "warning"
      }
    ];
  }

  // If the linter exits non-zero, treat its output as error messages
  if (result.exitCode !== 0) {
    const output = (result.stdout || result.stderr).trim();
    if (!output) {
      return [
        {
          rule: "linter-fail",
          message: `Linter exited with code ${String(result.exitCode)}.`,
          severity: "error"
        }
      ];
    }

    // Parse line-based output: try to extract "file:line:col: message" format
    return parseLinterOutput(output);
  }

  return [];
}

/** Parse common linter output format: file:line:col: message */
function parseLinterOutput(output: string): StaticAnalysisViolation[] {
  const violations: StaticAnalysisViolation[] = [];
  const linePattern = /^.*?:(\d+):(\d+):\s*(.+)$/;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = linePattern.exec(trimmed);
    if (match) {
      violations.push({
        line: parseInt(match[1]!, 10),
        column: parseInt(match[2]!, 10),
        rule: "linter",
        message: match[3]!,
        severity: "error"
      });
    } else {
      violations.push({
        rule: "linter",
        message: trimmed,
        severity: "error"
      });
    }
  }

  return violations;
}

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Safely construct a regex, returning null if invalid. */
function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "g");
  } catch {
    return null;
  }
}

/** Rough heuristic: skip lines that look like single-line comments. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*");
}
