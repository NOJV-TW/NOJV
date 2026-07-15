import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { testPrisma } from "../../fixtures/factories";
import { splitStatements } from "../../setup/replay-constraints";

const MIGRATIONS = [
  "20260716000011_versioned_blob_pointers_expand",
  "20260716000012_versioned_blob_pointers_contract",
] as const;

async function createLegacyTables(schema: string): Promise<void> {
  await testPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await testPrisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Problem" (
        "id" TEXT PRIMARY KEY,
        "judgeConfig" JSONB NOT NULL DEFAULT '{"type":"standard"}'::jsonb
      )
    `);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Testcase" (
        "id" TEXT PRIMARY KEY,
        "inputKey" TEXT NOT NULL,
        "outputKey" TEXT,
        "inputFileKeys" JSONB
      )
    `);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "ProblemWorkspaceFile" (
        "id" TEXT PRIMARY KEY,
        "contentKey" TEXT NOT NULL
      )
    `);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Submission" (
        "id" TEXT PRIMARY KEY,
        "sourceStoragePrefix" TEXT NOT NULL,
        "verdictDetailStorageKey" TEXT
      )
    `);
  });
}

async function applyMigration(schema: string, migration: (typeof MIGRATIONS)[number]) {
  const sql = readFileSync(
    join(process.cwd(), "packages/db/prisma/migrations", migration, "migration.sql"),
    "utf8",
  );
  await testPrisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    for (const statement of splitStatements(sql)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });
}

function pointer(key: string): string {
  return JSON.stringify({ key, sha256: "a".repeat(64), size: 1 });
}

describe("versioned storage pointer migration", () => {
  it("keeps the destructive contract atomic after the external preflight", async () => {
    const schema = `storage_pointer_${randomUUID().replaceAll("-", "")}`;
    await createLegacyTables(schema);
    try {
      await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Problem" ("id", "judgeConfig")
          VALUES ('problem_1', '{"type":"checker","checkerKey":"legacy/checker"}')
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Testcase" ("id", "inputKey", "outputKey")
          VALUES ('testcase_1', 'legacy/input', 'legacy/output')
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "ProblemWorkspaceFile" ("id", "contentKey")
          VALUES ('workspace_1', 'legacy/workspace')
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Submission" (
            "id", "sourceStoragePrefix", "verdictDetailStorageKey"
          ) VALUES ('submission_1', 'legacy/sources/', 'legacy/verdict')
        `);
      });

      await applyMigration(schema, MIGRATIONS[0]);
      const blocked = await applyMigration(schema, MIGRATIONS[1]).catch(
        (reason: unknown) => reason,
      );
      expect(blocked).toBeInstanceOf(Error);
      expect((blocked as Error).message).toContain(
        'column "inputStorage" of relation "Testcase" contains null values',
      );

      await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await transaction.$executeRawUnsafe(`
          UPDATE "Problem"
          SET "judgeConfig" = '{"type":"checker"}',
              "checkerStorage" = '${pointer("problems/problem_1/validators/v1/checker")}'
          WHERE "id" = 'problem_1'
        `);
        await transaction.$executeRawUnsafe(`
          UPDATE "Testcase"
          SET "inputStorage" = '${pointer("problems/problem_1/testcases/testcase_1/versions/v1/input")}',
              "outputStorage" = '${pointer("problems/problem_1/testcases/testcase_1/versions/v1/output")}'
          WHERE "id" = 'testcase_1'
        `);
        await transaction.$executeRawUnsafe(`
          UPDATE "ProblemWorkspaceFile"
          SET "contentStorage" = '${pointer("problems/problem_1/workspace/workspace_1/versions/v1")}'
          WHERE "id" = 'workspace_1'
        `);
        await transaction.$executeRawUnsafe(`
          UPDATE "Submission"
          SET "sourceStorage" = '${pointer("submissions/submission_1/source-generations/v1/manifest.json")}',
              "verdictDetailStorage" = '${pointer("submissions/submission_1/judge-runs/run_1/verdict-detail.json")}'
          WHERE "id" = 'submission_1'
        `);
      });

      await expect(applyMigration(schema, MIGRATIONS[1])).resolves.toBeUndefined();
      const legacyColumns = await testPrisma.$queryRawUnsafe<{ count: bigint }[]>(`
        SELECT count(*) AS count
        FROM information_schema.columns
        WHERE table_schema = '${schema}'
          AND column_name IN (
            'inputKey', 'outputKey', 'inputFileKeys', 'contentKey',
            'sourceStoragePrefix', 'verdictDetailStorageKey'
          )
      `);
      expect(legacyColumns[0]?.count).toBe(0n);
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
