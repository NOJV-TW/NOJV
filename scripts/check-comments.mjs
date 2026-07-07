#!/usr/bin/env node
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const strict = process.argv.includes("--strict") || process.env.COMMENT_GUARD_STRICT === "1";

const PATTERNS = [
  "apps/**/src/**/*.{ts,tsx,svelte,mjs,js}",
  "packages/**/src/**/*.{ts,tsx,mjs,js}",
];

const IGNORE_PATH =
  /(^|\/)(dist|build|node_modules|\.svelte-kit|coverage)\/|paraglide\/|\.d\.ts$|\.generated\./;

const ALLOW = [
  /^eslint-(disable|enable|env)/,
  /^@ts-(expect-error|ignore|nocheck|check)/,
  /^prettier-ignore/,
  /^svelte-ignore/,
  /^v8\s+ignore/,
  /^(c8|istanbul)\s/,
  /^intentional-nullable/,
  /^globals?\s/,
  /^@vitest/,
  /^type-coverage:/,
  /^SPDX-/i,
  /copyright/i,
  /^@license/i,
];

function isAllowed(content) {
  return ALLOW.some((re) => re.test(content.trim()));
}

function maskNonScript(source) {
  const chars = source.split("").map((ch) => (ch === "\n" ? "\n" : " "));
  const re = /<script[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
    const body = match[1];
    const start = match.index + match[0].indexOf(body);
    for (let k = 0; k < body.length; k++) chars[start + k] = body[k];
  }
  return chars.join("");
}

function collectComments(source) {
  const found = [];
  let line = 1;
  let inString = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\n") {
      line++;
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
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      let j = i + 2;
      let content = "";
      while (j < source.length && source[j] !== "\n") content += source[j++];
      found.push({ line, content });
      i = j - 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const startLine = line;
      let j = i + 2;
      let content = "";
      while (j < source.length && !(source[j] === "*" && source[j + 1] === "/")) {
        if (source[j] === "\n") line++;
        content += source[j++];
      }
      found.push({ line: startLine, content });
      i = j + 1;
      continue;
    }
  }
  return found;
}

const files = globSync(PATTERNS, { cwd: repoRoot }).filter((f) => !IGNORE_PATH.test(f));
const offenders = [];
for (const rel of files) {
  const raw = readFileSync(resolve(repoRoot, rel), "utf8");
  const source = rel.endsWith(".svelte") ? maskNonScript(raw) : raw;
  for (const { line, content } of collectComments(source)) {
    if (isAllowed(content)) continue;
    offenders.push(`${rel}:${String(line)}: ${content.trim().slice(0, 100)}`);
  }
}

if (offenders.length === 0) {
  console.log("check-comments: clean");
  process.exit(0);
}

const header = strict
  ? "check-comments: code comments are forbidden (zero-comment policy). Remove these or add an allowed directive:"
  : `check-comments: ${String(offenders.length)} code comment(s) present (zero-comment policy). New comments should be removed:`;
const log = strict ? console.error : console.warn;
log(header);
for (const o of offenders) log(`  ${o}`);
process.exit(strict ? 1 : 0);
