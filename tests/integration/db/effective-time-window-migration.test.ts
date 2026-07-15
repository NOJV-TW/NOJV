import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { testPrisma } from "../../fixtures/factories";
import { splitStatements } from "../../setup/replay-constraints";

const MIGRATION = "20260716000005_effective_time_window_constraints";
const MIGRATION_SQL = join(
  process.cwd(),
  "packages/db/prisma/migrations",
  MIGRATION,
  "migration.sql",
);

async function createWindowTables(schema: string): Promise<void> {
  await testPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await testPrisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Exam" (
        "id" TEXT PRIMARY KEY,
        "startsAt" TIMESTAMP(3) NOT NULL,
        "endsAt" TIMESTAMP(3) NOT NULL
      )
    `);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Contest" (
        "id" TEXT PRIMARY KEY,
        "startsAt" TIMESTAMP(3) NOT NULL,
        "endsAt" TIMESTAMP(3) NOT NULL
      )
    `);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Assessment" (
        "id" TEXT PRIMARY KEY,
        "opensAt" TIMESTAMP(3) NOT NULL,
        "dueAt" TIMESTAMP(3),
        "closesAt" TIMESTAMP(3) NOT NULL
      )
    `);
  });
}

async function applyMigration(schema: string): Promise<void> {
  const sql = readFileSync(MIGRATION_SQL, "utf8");
  await testPrisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    for (const statement of splitStatements(sql)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });
}

async function constraintState(
  schema: string,
): Promise<{ conname: string; convalidated: boolean }[]> {
  return testPrisma.$queryRawUnsafe(`
    SELECT constraint_row.conname, constraint_row.convalidated
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = '${schema}'
      AND constraint_row.conname LIKE '%_effective_time_window_chk'
    ORDER BY constraint_row.conname
  `);
}

describe("effective time-window migration", () => {
  it("aborts dirty schemas with every offending id and leaves no partial constraints", async () => {
    const schema = `window_dirty_${randomUUID().replaceAll("-", "")}`;
    await createWindowTables(schema);

    try {
      await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Exam" ("id", "startsAt", "endsAt")
          VALUES ('exam_bad', '2030-01-02', '2030-01-01')
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Contest" ("id", "startsAt", "endsAt")
          VALUES ('contest_bad', '2030-01-02', '2030-01-02')
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Assessment" ("id", "opensAt", "dueAt", "closesAt")
          VALUES ('assessment_bad', '2030-01-01', '2030-01-03', '2030-01-02')
        `);
      });

      const error = await applyMigration(schema).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("exam_bad");
      expect((error as Error).message).toContain("contest_bad");
      expect((error as Error).message).toContain("assessment_bad");
      expect(await constraintState(schema)).toEqual([]);
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("adds and validates all constraints when existing rows are valid", async () => {
    const schema = `window_valid_${randomUUID().replaceAll("-", "")}`;
    await createWindowTables(schema);

    try {
      await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Exam" ("id", "startsAt", "endsAt")
          VALUES ('exam_ok', '2030-01-01', '2030-01-02')
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Contest" ("id", "startsAt", "endsAt")
          VALUES ('contest_ok', '2030-01-01', '2030-01-02')
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Assessment" ("id", "opensAt", "dueAt", "closesAt")
          VALUES ('assessment_ok', '2030-01-01', '2030-01-02', '2030-01-02')
        `);
      });

      await applyMigration(schema);

      expect(await constraintState(schema)).toEqual([
        { conname: "Assessment_effective_time_window_chk", convalidated: true },
        { conname: "Contest_effective_time_window_chk", convalidated: true },
        { conname: "Exam_effective_time_window_chk", convalidated: true },
      ]);
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
