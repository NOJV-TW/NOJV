import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PrismaClient } from "../../generated/prisma/client";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

export function migrationTriggerNames(): Set<string> {
  const names = new Set<string>();
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    for (const [, action = "", name = ""] of sql.matchAll(
      /\b(CREATE|DROP)\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi,
    )) {
      if (action.toUpperCase() === "CREATE") names.add(name);
      else names.delete(name);
    }
  }
  return names;
}

export async function assertMigrationTriggers(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
  `;
  const present = new Set(rows.map((row) => row.tgname));
  const missing = [...migrationTriggerNames()].filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Database is missing migration-defined triggers (${missing.join(", ")}); it was likely built with \`prisma db push\`, which skips migration SQL. Apply migrations with \`pnpm db:deploy\` on an empty database (or \`pnpm --filter @nojv/db exec prisma migrate reset --force\`), then seed again.`,
    );
  }
}
