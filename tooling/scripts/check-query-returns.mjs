#!/usr/bin/env node
/**
 * Domain query null-return guard.
 *
 * Enforces the convention documented in docs/DESIGN.md ("Domain error
 * handling"): functions in `packages/domain/src/**\/queries.ts` whose
 * names match /^(get|load|fetch|require)[A-Z]/ must not fall back to
 * `return null` when an entity is missing. They should throw
 * `NotFoundError` (or another `HttpError` from
 * `packages/domain/src/shared/errors.ts`) so the SvelteKit `handleLoad`
 * wrapper can translate it into a 4xx response.
 *
 * Escape hatch: if a specific function is a legitimate nullable helper
 * (e.g. a toggle, or "already in target state" no-op), annotate the
 * declaration with a leading line comment containing
 * `intentional-nullable`:
 *
 *   // intentional-nullable: already unfrozen is a valid business state
 *   export async function unfreezeContest(slug: string) { ... }
 *
 * The guard is a tiny regex-based script rather than an ESLint plugin
 * because the repo has no custom-rule infrastructure. See the commit
 * that introduced FU-16 for rationale.
 */

import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const PATTERN = "packages/domain/src/**/queries.ts";
const PREFIX_RE = /^(get|load|fetch|require)[A-Z]/;
const TAG = "intentional-nullable";

/**
 * Walk one queries.ts file and yield each exported function whose
 * name matches the targeted prefixes, together with the slice of
 * source covered by its body.
 */
function* iterExportedFunctions(source) {
  const declRe = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[<(]/gm;
  let match;
  while ((match = declRe.exec(source)) !== null) {
    const name = match[1];
    if (!PREFIX_RE.test(name)) continue;

    // Find the opening brace of the function body after the signature.
    let i = match.index;
    let braceStart = -1;
    let parenDepth = 0;
    let angleDepth = 0;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "<") angleDepth++;
      else if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
      else if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
      else if (ch === "{" && parenDepth === 0 && angleDepth === 0) {
        braceStart = i;
        break;
      }
    }
    if (braceStart === -1) continue;

    // Walk to the matching closing brace, ignoring braces inside
    // strings, template literals, and comments. For the queries
    // files this simple tokenizer is sufficient.
    let depth = 0;
    let j = braceStart;
    let inLine = false;
    let inBlock = false;
    let inString = null;
    let escaped = false;
    for (; j < source.length; j++) {
      const ch = source[j];
      const next = source[j + 1];
      if (inLine) {
        if (ch === "\n") inLine = false;
        continue;
      }
      if (inBlock) {
        if (ch === "*" && next === "/") {
          inBlock = false;
          j++;
        }
        continue;
      }
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === "/" && next === "/") {
        inLine = true;
        j++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlock = true;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }

    const body = source.slice(braceStart, j);
    yield { name, declIndex: match.index, body };
  }
}

/**
 * Return the line immediately preceding the function declaration.
 */
function precedingLine(source, declIndex) {
  const before = source.slice(0, declIndex);
  const lines = before.split("\n");
  return lines.length >= 2 ? lines[lines.length - 2] : "";
}

function check(file) {
  const source = readFileSync(file, "utf8");
  const violations = [];
  for (const fn of iterExportedFunctions(source)) {
    if (!/\breturn\s+null\b/.test(fn.body)) continue;
    const prev = precedingLine(source, fn.declIndex);
    if (prev.includes(TAG)) continue;
    violations.push(fn.name);
  }
  return violations;
}

const files = globSync(PATTERN, { cwd: repoRoot }).map((p) => resolve(repoRoot, p));
let failed = false;
for (const file of files) {
  const violations = check(file);
  if (violations.length === 0) continue;
  failed = true;
  const rel = file.slice(repoRoot.length + 1);
  for (const name of violations) {
    console.error(
      `${rel}: ${name} returns null. Throw NotFoundError instead, ` +
        `or add a leading \`// ${TAG}: <why>\` comment.`
    );
  }
}

if (failed) {
  console.error("");
  console.error("See docs/DESIGN.md 'Domain error handling' for the full convention.");
  process.exit(1);
}

console.log(
  `check-query-returns: scanned ${String(files.length)} queries.ts file(s); no violations.`
);
