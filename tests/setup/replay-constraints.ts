import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "packages/db/prisma/migrations");

const CHECK_RE = /ALTER TABLE\s+("?\w+"?)\s+ADD CONSTRAINT\s+("?\w+"?)\s+CHECK/is;
const GIN_EXPR_RE =
  /CREATE INDEX\s+("?\w+"?)\s+ON\s+("?\w+"?)[\s\S]+?USING GIN\s*\(\s*\w+\s*\(/is;
const DROP_CONSTRAINT_RE = /DROP CONSTRAINT(?:\s+IF EXISTS)?\s+("?\w+"?)/is;
const DROP_INDEX_RE = /DROP INDEX(?:\s+IF EXISTS)?\s+("?\w+"?)/is;
const RENAME_COL_RE = /ALTER TABLE\s+("?\w+"?)\s+RENAME COLUMN\s+("?\w+"?)\s+TO\s+("?\w+"?)/is;

interface Ddl {
  table: string;
  drop: string;
  create: string;
}

function splitStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, "")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function collectReplayStatements(): string[] {
  const checks = new Map<string, Ddl>();
  const indexes = new Map<string, Ddl>();

  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    for (const stmt of splitStatements(sql)) {
      const rename = RENAME_COL_RE.exec(stmt);
      if (rename) {
        const [, table, oldCol, newCol] = rename;
        for (const ddl of [...checks.values(), ...indexes.values()]) {
          if (ddl.table === table) ddl.create = ddl.create.split(oldCol).join(newCol);
        }
        continue;
      }

      const check = CHECK_RE.exec(stmt);
      if (check) {
        const [, table, name] = check;
        checks.set(name, {
          table,
          drop: `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`,
          create: stmt,
        });
        continue;
      }

      const gin = GIN_EXPR_RE.exec(stmt);
      if (gin) {
        const [, name, table] = gin;
        indexes.set(name, { table, drop: `DROP INDEX IF EXISTS ${name}`, create: stmt });
        continue;
      }

      if (/ADD CONSTRAINT/i.test(stmt)) continue;
      const dropConstraint = DROP_CONSTRAINT_RE.exec(stmt);
      if (dropConstraint) {
        checks.delete(dropConstraint[1]);
        continue;
      }
      const dropIdx = DROP_INDEX_RE.exec(stmt);
      if (dropIdx) indexes.delete(dropIdx[1]);
    }
  }

  return [...checks.values(), ...indexes.values()].flatMap(({ drop, create }) => [
    drop,
    create,
  ]);
}
