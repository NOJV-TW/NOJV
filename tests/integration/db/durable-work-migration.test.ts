import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { testPrisma } from "../../fixtures/factories";
import { splitStatements } from "../../setup/replay-constraints";

const MIGRATION = "20260716000006_durable_work";
const MIGRATION_SQL = join(
  process.cwd(),
  "packages/db/prisma/migrations",
  MIGRATION,
  "migration.sql",
);

async function applyMigration(schema: string): Promise<void> {
  await testPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const sql = readFileSync(MIGRATION_SQL, "utf8");
  await testPrisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    for (const statement of splitStatements(sql)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });
}

describe("durable work migration", () => {
  it("creates validated state constraints, dedupe uniqueness, and claim indexes", async () => {
    const schema = `durable_work_${randomUUID().replaceAll("-", "")}`;
    await applyMigration(schema);

    try {
      const constraints = await testPrisma.$queryRawUnsafe<
        { conname: string; contype: string; convalidated: boolean }[]
      >(`
        SELECT
          constraint_row.conname,
          constraint_row.contype::text AS contype,
          constraint_row.convalidated
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
        JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
        WHERE namespace_row.nspname = '${schema}'
          AND table_row.relname = 'DurableWork'
        ORDER BY constraint_row.conname
      `);
      expect(constraints).toEqual(
        expect.arrayContaining([
          { conname: "DurableWork_pkey", contype: "p", convalidated: true },
          { conname: "DurableWork_kind_dedupeKey_key", contype: "u", convalidated: true },
          { conname: "DurableWork_attempts_chk", contype: "c", convalidated: true },
          { conname: "DurableWork_state_chk", contype: "c", convalidated: true },
          { conname: "DurableWork_identifiers_chk", contype: "c", convalidated: true },
        ]),
      );

      const indexes = await testPrisma.$queryRawUnsafe<{ indexname: string }[]>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = '${schema}' AND tablename = 'DurableWork'
        ORDER BY indexname
      `);
      expect(indexes.map(({ indexname }) => indexname)).toEqual(
        expect.arrayContaining([
          "DurableWork_status_availableAt_createdAt_idx",
          "DurableWork_status_leaseExpiresAt_idx",
          "DurableWork_kind_status_availableAt_idx",
        ]),
      );

      const invalidInsert = async (values: string) =>
        testPrisma.$executeRawUnsafe(`
          INSERT INTO "${schema}"."DurableWork"
            ("id", "kind", "dedupeKey", "payload", "status", "availableAt", "attempt", "maxAttempts", "createdAt", "updatedAt")
          VALUES ${values}
        `);

      await expect(
        invalidInsert("('blank-kind', ' ', 'key', '{}', 'pending', NOW(), 0, 3, NOW(), NOW())"),
      ).rejects.toThrow();
      await expect(
        invalidInsert(
          "('bad-pending', 'kind', 'key-2', '{}', 'pending', NOW(), 3, 3, NOW(), NOW())",
        ),
      ).rejects.toThrow();
      await expect(
        invalidInsert(
          "('bad-leased', 'kind', 'key-3', '{}', 'leased', NOW(), 1, 3, NOW(), NOW())",
        ),
      ).rejects.toThrow();
      await expect(
        invalidInsert(
          "('bad-cancelled', 'kind', 'key-4', '{}', 'cancelled', NOW(), 0, 3, NOW(), NOW())",
        ),
      ).rejects.toThrow();
      await expect(
        testPrisma.$executeRawUnsafe(`
          INSERT INTO "${schema}"."DurableWork"
            ("id", "kind", "dedupeKey", "payload", "status", "availableAt", "attempt", "maxAttempts", "completedAt", "createdAt", "updatedAt")
          VALUES ('valid-cancelled', 'kind', 'key-5', '{}', 'cancelled', NOW(), 0, 3, NOW(), NOW(), NOW())
        `),
      ).resolves.toBe(1);
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
