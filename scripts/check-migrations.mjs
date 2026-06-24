#!/usr/bin/env node
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const dirs = globSync("packages/db/prisma/migrations/*/migration.sql", { cwd: repoRoot })
  .map((p) => p.split("/").at(-2))
  .filter((d) => typeof d === "string")
  .sort();

// Timestamp prefixes that already shipped duplicated (disjoint objects, no bug);
// the guard only blocks NEW collisions.
const ALLOWED_DUP_PREFIXES = new Set(["20260419120000", "20260430000000", "20260512000000"]);

// Only enforce expand/contract on migrations authored after this baseline so the
// existing history (which predates the convention) is exempt.
const EXPAND_CONTRACT_BASELINE = "20260624999999";
const OVERRIDE_MARKER = "expand-contract-ok";
const DESTRUCTIVE = [
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bRENAME\s+(COLUMN|TO)\b/i,
  /\bSET\s+NOT\s+NULL\b/i,
];

const errors = [];

const byPrefix = new Map();
for (const dir of dirs) {
  const prefix = dir.slice(0, 14);
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(dir);
}
for (const [prefix, members] of byPrefix) {
  if (members.length > 1 && !ALLOWED_DUP_PREFIXES.has(prefix)) {
    errors.push(`duplicate migration timestamp prefix ${prefix}: ${members.join(", ")}`);
  }
}

for (const dir of dirs) {
  const prefix = dir.slice(0, 14);
  if (prefix <= EXPAND_CONTRACT_BASELINE) continue;
  const sql = readFileSync(
    resolve(repoRoot, "packages/db/prisma/migrations", dir, "migration.sql"),
    "utf8",
  );
  if (sql.includes(OVERRIDE_MARKER)) continue;
  const hit = DESTRUCTIVE.find((re) => re.test(sql));
  if (hit) {
    errors.push(
      `${dir}: non-additive statement (${String(hit)}) without an expand/contract review. ` +
        `Old revisions run against the new schema during a rolling deploy — split into ` +
        `expand→migrate→contract, or add a "-- ${OVERRIDE_MARKER}: <reason>" comment if intentional.`,
    );
  }
}

if (errors.length > 0) {
  console.error("Migration safety check failed:");
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log("check-migrations: clean");
