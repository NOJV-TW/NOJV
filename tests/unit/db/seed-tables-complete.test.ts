import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const schemaDir = join(repoRoot, "packages/db/prisma/schema");
const seedFile = join(repoRoot, "tests/fixtures/seed-test-db.ts");

function schemaModels(): string[] {
  const names: string[] = [];
  for (const file of readdirSync(schemaDir)) {
    if (!file.endsWith(".prisma")) continue;
    const text = readFileSync(join(schemaDir, file), "utf8");
    for (const m of text.matchAll(/^model\s+(\w+)\s*\{/gm)) names.push(m[1]);
  }
  return names;
}

function truncatedTables(): Set<string> {
  const text = readFileSync(seedFile, "utf8");
  const block = /export const TABLES\s*=\s*\[([\s\S]*?)]/.exec(text);
  if (!block) throw new Error("Could not locate TABLES in seed-test-db.ts");
  return new Set([...block[1].matchAll(/"(\w+)"/g)].map((m) => m[1]));
}

describe("seed-test-db TABLES completeness (drift guard)", () => {
  it("truncates every Prisma model so no rows leak across tests", () => {
    const tables = truncatedTables();
    const missing = schemaModels().filter((m) => !tables.has(m));
    expect(
      missing,
      `Models missing from seed-test-db TABLES (rows can leak across tests): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("does not list tables that are not Prisma models", () => {
    const models = new Set(schemaModels());
    const orphans = [...truncatedTables()].filter((t) => !models.has(t));
    expect(
      orphans,
      `TABLES entries with no matching Prisma model: ${orphans.join(", ")}`,
    ).toEqual([]);
  });
});
