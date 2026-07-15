import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "packages/db/prisma/migrations");

const CHECK_RE = /ALTER TABLE\s+("?\w+"?)\s+ADD CONSTRAINT\s+("?\w+"?)\s+CHECK/is;
const GIN_EXPR_RE =
  /CREATE INDEX\s+("?\w+"?)\s+ON\s+("?\w+"?)[\s\S]+?USING GIN\s*\(\s*\w+\s*\(/is;
const RAW_FOREIGN_KEY_RE =
  /ALTER TABLE\s+("?\w+"?)\s+ADD CONSTRAINT\s+("?Submission_(?:assessment_course|participation_owner)_fkey"?)\s+FOREIGN KEY/is;
const DROP_CONSTRAINT_RE = /DROP CONSTRAINT(?:\s+IF EXISTS)?\s+("?\w+"?)/is;
const DROP_INDEX_RE = /DROP INDEX(?:\s+IF EXISTS)?\s+("?\w+"?)/is;
const RENAME_COL_RE = /ALTER TABLE\s+("?\w+"?)\s+RENAME COLUMN\s+("?\w+"?)\s+TO\s+("?\w+"?)/is;
const RENAME_CONSTRAINT_RE =
  /ALTER TABLE\s+("?\w+"?)\s+RENAME CONSTRAINT\s+("?\w+"?)\s+TO\s+("?\w+"?)/is;
const VALIDATE_CONSTRAINT_RE = /ALTER TABLE\s+("?\w+"?)\s+VALIDATE CONSTRAINT\s+("?\w+"?)/is;

interface Ddl {
  table: string;
  drop: string;
  create: string;
  validate?: string;
}

export function splitStatements(sql: string): string[] {
  const source = sql.replace(/^\s*--.*$/gm, "");
  const statements: string[] = [];
  let start = 0;
  let dollarTag: string | null = null;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    const character = source[index];
    if (inSingleQuote) {
      if (character === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (character === '"' && source[index + 1] === '"') {
        index += 1;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (character === "'") {
      inSingleQuote = true;
      continue;
    }
    if (character === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (character === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(source.slice(index))?.[0];
      if (tag) {
        dollarTag = tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (character === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

export function collectReplayStatements(): string[] {
  const checks = new Map<string, Ddl>();
  const indexes = new Map<string, Ddl>();
  const foreignKeys = new Map<string, Ddl>();
  const functions: string[] = [];
  const triggers: string[] = [];

  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    for (const stmt of splitStatements(sql)) {
      if (/^(?:CREATE(?:\s+OR\s+REPLACE)?|DROP)\s+FUNCTION\b/is.test(stmt)) {
        functions.push(stmt);
        continue;
      }
      if (/^(?:CREATE|DROP)\s+TRIGGER\b/is.test(stmt)) {
        triggers.push(stmt);
        continue;
      }
      const rename = RENAME_COL_RE.exec(stmt);
      if (rename) {
        const [, table, oldCol, newCol] = rename;
        for (const ddl of [...checks.values(), ...indexes.values()]) {
          if (ddl.table === table) ddl.create = ddl.create.split(oldCol).join(newCol);
        }
        continue;
      }

      const constraintRename = RENAME_CONSTRAINT_RE.exec(stmt);
      if (constraintRename) {
        const [, table, oldName, newName] = constraintRename;
        const collection = checks.has(oldName)
          ? checks
          : foreignKeys.has(oldName)
            ? foreignKeys
            : null;
        const ddl = collection?.get(oldName);
        if (ddl?.table === table && collection) {
          collection.delete(oldName);
          collection.set(newName, {
            table,
            drop: `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${newName}`,
            create: ddl.create.replace(oldName, newName),
            ...(ddl.validate ? { validate: ddl.validate.replace(oldName, newName) } : {}),
          });
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

      const validate = VALIDATE_CONSTRAINT_RE.exec(stmt);
      if (validate) {
        const [, table, name] = validate;
        const ddl = checks.get(name) ?? foreignKeys.get(name);
        if (ddl?.table === table) ddl.validate = stmt;
        continue;
      }

      const gin = GIN_EXPR_RE.exec(stmt);
      if (gin) {
        const [, name, table] = gin;
        indexes.set(name, { table, drop: `DROP INDEX IF EXISTS ${name}`, create: stmt });
        continue;
      }

      const foreignKey = RAW_FOREIGN_KEY_RE.exec(stmt);
      if (foreignKey) {
        const [, table, name] = foreignKey;
        foreignKeys.set(name, {
          table,
          drop: `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`,
          create: stmt,
        });
        continue;
      }

      if (/ADD CONSTRAINT/i.test(stmt)) continue;
      const dropConstraint = DROP_CONSTRAINT_RE.exec(stmt);
      if (dropConstraint) {
        checks.delete(dropConstraint[1]);
        foreignKeys.delete(dropConstraint[1]);
        continue;
      }
      const dropIdx = DROP_INDEX_RE.exec(stmt);
      if (dropIdx) indexes.delete(dropIdx[1]);
    }
  }

  return [
    ...functions,
    ...[...checks.values(), ...indexes.values(), ...foreignKeys.values()].flatMap(
      ({ drop, create, validate }) => [drop, create, ...(validate ? [validate] : [])],
    ),
    ...triggers,
  ];
}
