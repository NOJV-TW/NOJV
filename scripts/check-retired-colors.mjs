#!/usr/bin/env node
// Guards against the retired burnt-orange/brown palette creeping back in after
// the teal rebrand. New colors must go through the design tokens in app.css
// (--primary, --success, --warning, --destructive, --chart-*), not raw hex.
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const RETIRED = [/#c4682d/i, /#8a6142/i, /#d4a054/i, /#b07d2c/i, /#b8a085/i, /196,\s*104,\s*45/, /77,\s*141,\s*91/, /184,\s*55,\s*42/, /79,\s*52,\s*35/];

const files = globSync("apps/web/src/**/*.{svelte,ts}", { cwd: repoRoot });
const offenders = [];
for (const rel of files) {
  const source = readFileSync(resolve(repoRoot, rel), "utf8");
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (RETIRED.some((re) => re.test(line))) {
      offenders.push(`${rel}:${String(i + 1)}: ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error("Retired palette colors found — use the teal design tokens (app.css) instead:");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log("check-retired-colors: clean");
