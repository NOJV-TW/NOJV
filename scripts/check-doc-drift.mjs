#!/usr/bin/env node
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const BANNED = [/packages\/domain\b/, /@nojv\/domain\b/];

const files = ["AGENT.md", "README.md", ...globSync("docs/**/*.md", { cwd: repoRoot })];

const offenders = [];
for (const rel of files) {
  let source;
  try {
    source = readFileSync(resolve(repoRoot, rel), "utf8");
  } catch {
    continue;
  }
  source.split("\n").forEach((line, i) => {
    if (BANNED.some((re) => re.test(line))) {
      offenders.push(`${rel}:${String(i + 1)}: ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error("Stale 'domain' package reference (the package is @nojv/application):");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log("check-doc-drift: clean");
