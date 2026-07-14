import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";

import { PrismaClient } from "../../../packages/db/generated/prisma/client";
import { testPrisma } from "../../fixtures/factories";

const repoRoot = process.cwd();
const migrationsRoot = join(repoRoot, "packages/db/prisma/migrations");
const firstBranchMigration = "20260716000001_registry_security_generation_trigger";
const contractMigration = "20260716000012_versioned_blob_pointers_contract";

function databaseUrl(database: string): string {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
  const url = new URL(value);
  url.pathname = `/${database}`;
  url.searchParams.delete("schema");
  return url.toString();
}

function originMainMigrationStage(): string {
  const stage = mkdtempSync(join(tmpdir(), "nojv-origin-main-migrations-"));
  cpSync(join(migrationsRoot, "migration_lock.toml"), join(stage, "migration_lock.toml"));
  for (const name of readdirSync(migrationsRoot).sort()) {
    if (name >= firstBranchMigration) break;
    if (name === "migration_lock.toml") continue;
    const source = join(migrationsRoot, name);
    mkdirSync(join(stage, name));
    cpSync(join(source, "migration.sql"), join(stage, name, "migration.sql"));
  }
  return stage;
}

function migrate(url: string, migrations?: string): string {
  return execFileSync("pnpm", ["--filter", "@nojv/db", "exec", "prisma", "migrate", "deploy"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: url,
      ...(migrations ? { PRISMA_MIGRATIONS_PATH: migrations } : {}),
    },
  });
}

function cutoverCommand(url: string, command: "preflight" | "status"): string {
  return execFileSync(
    "pnpm",
    [
      "--filter",
      "@nojv/db",
      "exec",
      "node",
      "--import",
      "tsx",
      "prisma/scripts/storage-pointer-cutover.ts",
      command,
    ],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, DATABASE_URL: url } },
  ).trim();
}

function pointer(key: string): string {
  return JSON.stringify({ key, sha256: "a".repeat(64), size: 1 });
}

describe("storage release migration history", () => {
  it("upgrades populated origin/main history without a failed contract or P3009", async () => {
    const database = `nojv_storage_release_${randomUUID().replaceAll("-", "")}`;
    const url = databaseUrl(database);
    const originStage = originMainMigrationStage();
    await testPrisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    const migrationPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    try {
      migrate(url, originStage);
      await migrationPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`
          INSERT INTO "User" ("id", "email", "name", "updatedAt")
          VALUES ('student', 'student@example.com', 'Student', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Problem" (
            "id", "title", "timeLimitMs", "memoryLimitMb", "judgeConfig", "updatedAt"
          ) VALUES ('problem', 'Problem', 1000, 256, '{"type":"standard"}', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "TestcaseSet" ("id", "problemId", "name", "updatedAt")
          VALUES ('set', 'problem', 'main', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Testcase" (
            "id", "testcaseSetId", "ordinal", "inputKey", "updatedAt"
          ) VALUES ('case', 'set', 0, 'legacy/input', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "ProblemWorkspaceFile" (
            "id", "problemId", "language", "path", "contentKey", "visibility", "updatedAt"
          ) VALUES ('workspace', 'problem', 'cpp', 'main.cpp', 'legacy/workspace', 'editable', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Submission" (
            "id", "userId", "problemId", "language", "sourceStoragePrefix", "updatedAt"
          ) VALUES ('submission', 'student', 'problem', 'cpp', 'legacy/submission/', NOW())
        `);
      });

      expect(cutoverCommand(url, "status")).toBe("pending");
      await migrationPrisma.$executeRawUnsafe(`ALTER TABLE "Testcase" DROP COLUMN "inputKey"`);
      expect(cutoverCommand(url, "status")).toBe("unsafe");
      await migrationPrisma.$executeRawUnsafe(`
        ALTER TABLE "Testcase" ADD COLUMN "inputKey" TEXT NOT NULL DEFAULT ''
      `);
      expect(cutoverCommand(url, "status")).toBe("pending");
      execFileSync("sh", ["packages/db/prisma/scripts/deploy-expand.sh"], {
        cwd: repoRoot,
        env: { ...process.env, DATABASE_URL: url },
      });

      await migrationPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`
          UPDATE "Problem" SET "activeStorageBytes" = 2 WHERE "id" = 'problem'
        `);
        await transaction.$executeRawUnsafe(`
          UPDATE "Testcase"
          SET "inputStorage" = '${pointer("problems/problem/testcases/case/versions/bootstrap-v1/input")}'
          WHERE "id" = 'case'
        `);
        await transaction.$executeRawUnsafe(`
          UPDATE "ProblemWorkspaceFile"
          SET "contentStorage" = '${pointer("problems/problem/workspace/workspace/versions/bootstrap-v1")}'
          WHERE "id" = 'workspace'
        `);
        await transaction.$executeRawUnsafe(`
          UPDATE "Submission"
          SET "sourceStorage" = '${pointer("submissions/submission/source-generations/bootstrap-v1/manifest.json")}'
          WHERE "id" = 'submission'
        `);
      });

      expect(cutoverCommand(url, "preflight")).toBe(
        "Storage pointer database preflight passed.",
      );
      migrate(url);
      expect(cutoverCommand(url, "status")).toBe("applied");
      await migrationPrisma.$executeRawUnsafe(`
        ALTER TABLE "Testcase" ADD COLUMN "inputKey" TEXT NOT NULL DEFAULT 'legacy/drift'
      `);
      expect(cutoverCommand(url, "status")).toBe("unsafe");
      await migrationPrisma.$executeRawUnsafe(`ALTER TABLE "Testcase" DROP COLUMN "inputKey"`);
      expect(cutoverCommand(url, "status")).toBe("applied");

      const history = await migrationPrisma.$queryRaw<
        { migration_name: string; finished: boolean; rolled_back: boolean }[]
      >`
        SELECT
          migration_name,
          finished_at IS NOT NULL AS finished,
          rolled_back_at IS NOT NULL AS rolled_back
        FROM "_prisma_migrations"
        WHERE migration_name = ${contractMigration}
           OR finished_at IS NULL
           OR rolled_back_at IS NOT NULL
        ORDER BY migration_name
      `;
      expect(history).toEqual([
        { migration_name: contractMigration, finished: true, rolled_back: false },
      ]);
      expect(migrate(url)).toContain("No pending migrations to apply");

      const legacyColumns = await migrationPrisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN (
            'inputKey', 'outputKey', 'inputFileKeys', 'contentKey',
            'sourceStoragePrefix', 'verdictDetailStorageKey'
          )
      `;
      expect(legacyColumns[0]?.count).toBe(0n);
    } finally {
      rmSync(originStage, { recursive: true, force: true });
      await migrationPrisma.$disconnect();
      await testPrisma.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${database}' AND pid <> pg_backend_pid()
      `);
      await testPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`);
    }
  }, 60_000);
});
