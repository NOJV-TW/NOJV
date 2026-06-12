import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// `prisma db push` builds the test DB straight from the Prisma schema, which
// cannot express CHECK constraints or expression indexes (e.g. the FTS GIN).
// Those live only in the migration SQL, so a db-push test DB silently lacks
// them — a CHECK-violating write passes in integration tests but fails in prod.
// We replay the net effect of every migration's CHECK + expression-GIN DDL so
// the test DB enforces the same invariants prod does. Migrations stay the single
// source of truth — nothing is hand-duplicated here.
//
// One subtlety: a `RENAME COLUMN` rewrites a live CHECK in Postgres, but the
// migration *text* that created the CHECK still names the old column. We replay
// renames against already-collected DDL so the emitted text matches the column
// names the current schema (and db-push test DB) actually has.

const MIGRATIONS_DIR = join(process.cwd(), "packages/db/prisma/migrations");

const CHECK_RE = /ALTER TABLE\s+("?\w+"?)\s+ADD CONSTRAINT\s+("?\w+"?)\s+CHECK/is;
// Only expression GINs (a function call inside the parens) are migration-only;
// a bare-column array GIN like `USING GIN ("tags")` is schema-expressible and
// db push already builds it.
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

// Net-surviving CHECK constraints and expression-GIN indexes, keyed by name so
// a later DROP cancels an earlier ADD and a RENAME COLUMN updates the text.
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
