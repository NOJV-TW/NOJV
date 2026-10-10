import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { testPrisma } from "../../fixtures/factories";
import { splitStatements } from "../../setup/sql-statements";

const MIGRATION = join(
  process.cwd(),
  "packages/db/prisma/migrations/20261007120000_drop_workspace_visibility_hidden/migration.sql",
);

describe("drop hidden workspace visibility migration", () => {
  it("turns hidden workspace files into readonly ones and removes the enum value", async () => {
    const schema = `workspace_visibility_${randomUUID().replaceAll("-", "")}`;
    await testPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

    try {
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRawUnsafe(
          `CREATE TYPE "WorkspaceFileVisibility" AS ENUM ('editable', 'readonly', 'hidden')`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TABLE "ProblemWorkspaceFile" ("id" TEXT PRIMARY KEY, "visibility" "WorkspaceFileVisibility" NOT NULL)`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "ProblemWorkspaceFile" VALUES ('main', 'editable'), ('helper', 'readonly'), ('grader', 'hidden')`,
        );
        for (const statement of splitStatements(readFileSync(MIGRATION, "utf8"))) {
          if (/^(BEGIN|COMMIT)$/.test(statement)) continue;
          await tx.$executeRawUnsafe(statement);
        }
      });

      const rows = await testPrisma.$queryRawUnsafe<{ id: string; visibility: string }[]>(
        `SELECT "id", "visibility"::text AS "visibility" FROM "${schema}"."ProblemWorkspaceFile" ORDER BY "id"`,
      );
      expect(rows).toEqual([
        { id: "grader", visibility: "readonly" },
        { id: "helper", visibility: "readonly" },
        { id: "main", visibility: "editable" },
      ]);

      const labels = await testPrisma.$queryRawUnsafe<{ type: string; label: string }[]>(`
        SELECT t.typname AS type, e.enumlabel AS label
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = '${schema}'
        ORDER BY t.typname, e.enumsortorder
      `);
      expect(labels).toEqual([
        { type: "WorkspaceFileVisibility", label: "editable" },
        { type: "WorkspaceFileVisibility", label: "readonly" },
      ]);
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
