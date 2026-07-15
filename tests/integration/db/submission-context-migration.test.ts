import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";

import { PrismaClient } from "../../../packages/db/generated/prisma/client";
import { testPrisma } from "../../fixtures/factories";
import { resolveConfiguredDestructiveTestDatabase } from "../../setup/destructive-test-database";
import { splitStatements } from "../../setup/replay-constraints";

const MIGRATIONS_DIR = join(process.cwd(), "packages/db/prisma/migrations");
const CURRENT_MAIN_BASELINE = [
  "20260416120000_init",
  "20260702000000_contest_null_invite_codes",
  "20260702140000_clarification_visibility",
  "20260703000000_super_admin_flag",
  "20260705000000_problem_displayid_on_publish",
  "20260707000000_admin_audit_log",
  "20260708000000_drop_userstatus_disabled",
  "20260709000000_single_problem_statement",
  "20260710000000_notification_preference",
  "20260711000000_two_factor_master_switch",
  "20260712000000_user_profile_public",
  "20260713000000_problem_posts",
  "20260714000000_user_can_create_advanced_problems",
  "20260715000000_registry_credential",
  "20260716000000_registry_audit_actions",
] as const;
const CONTEXT_MIGRATIONS = [
  "20260716000013_submission_context_repair",
  "20260716000014_assessment_course_unique_index",
  "20260716000015_participation_owner_unique_index",
  "20260716000016_submission_context_constraints",
] as const;

async function applyMigration(schema: string, migration: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, migration, "migration.sql"), "utf8").replaceAll(
    '"public".',
    `"${schema}".`,
  );
  const adapter = await new PrismaPg({
    connectionString: resolveConfiguredDestructiveTestDatabase().databaseUrl,
  }).connect();
  const pool = (
    adapter as unknown as {
      underlyingDriver(): {
        connect(): Promise<{
          query<T extends Record<string, unknown> = Record<string, unknown>>(
            sql: string,
          ): Promise<{ rows: T[] }>;
          release(): void;
        }>;
      };
    }
  ).underlyingDriver();
  const connection = await pool.connect();
  try {
    const extension = await connection.query<{ schema: string }>(`
      SELECT namespace.nspname AS schema
      FROM pg_extension AS extension
      JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
      WHERE extension.extname = 'pg_trgm'
    `);
    const extensionSchema = extension.rows[0]?.schema;
    if (!extensionSchema && migration !== CURRENT_MAIN_BASELINE[0]) {
      throw new Error("pg_trgm extension is required for migration tests");
    }
    await connection.query(
      extensionSchema
        ? `SET search_path TO "${schema}", "${extensionSchema.replaceAll('"', '""')}", public`
        : `SET search_path TO "${schema}", public`,
    );
    for (const statement of splitStatements(sql)) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
    await adapter.dispose();
  }
}

async function applyContextMigrations(schema: string): Promise<void> {
  for (const migration of CONTEXT_MIGRATIONS) {
    await applyMigration(schema, migration);
  }
}

function databaseUrl(database: string): string {
  const url = new URL(resolveConfiguredDestructiveTestDatabase().databaseUrl);
  url.pathname = `/${database}`;
  url.searchParams.delete("schema");
  return url.toString();
}

function preContextMigrationStage(): string {
  const stage = mkdtempSync(join(tmpdir(), "nojv-pre-context-migrations-"));
  cpSync(join(MIGRATIONS_DIR, "migration_lock.toml"), join(stage, "migration_lock.toml"));
  for (const name of readdirSync(MIGRATIONS_DIR).sort()) {
    if (name >= CONTEXT_MIGRATIONS[0]) break;
    if (name === "migration_lock.toml") continue;
    mkdirSync(join(stage, name));
    cpSync(join(MIGRATIONS_DIR, name, "migration.sql"), join(stage, name, "migration.sql"));
  }
  return stage;
}

function migrate(url: string, migrations?: string): string {
  return execFileSync("pnpm", ["--filter", "@nojv/db", "exec", "prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: url,
      ...(migrations ? { PRISMA_MIGRATIONS_PATH: migrations } : {}),
    },
  });
}

describe("Submission canonical context migration", () => {
  it("rejects ambiguous current-main rows by ID, then repairs every lossless legacy shape", async () => {
    const schema = `submission_context_${randomUUID().replaceAll("-", "")}`;
    await testPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

    try {
      for (const migration of CURRENT_MAIN_BASELINE) {
        await applyMigration(schema, migration);
      }

      await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "User" ("id", "email", "name", "updatedAt")
          VALUES
            ('teacher', 'teacher@example.test', 'Teacher', NOW()),
            ('student', 'student@example.test', 'Student', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Course" ("id", "title", "description", "ownerId", "updatedAt")
          VALUES ('course-a', 'Course A', 'Course A description', 'teacher', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Assessment" (
            "id", "courseId", "title", "summary", "opensAt", "closesAt",
            "createdByUserId", "updatedAt"
          ) VALUES (
            'assignment-a', 'course-a', 'Assignment A', 'Assignment A summary',
            '2026-01-01', '2027-01-01', 'teacher', NOW()
          )
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Contest" (
            "id", "title", "summary", "startsAt", "endsAt", "updatedAt"
          ) VALUES (
            'contest-a', 'Contest A', 'Contest A summary',
            '2026-01-01', '2027-01-01', NOW()
          )
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Participation" (
            "id", "type", "userId", "contestId", "status", "startedAt", "endsAt", "updatedAt"
          ) VALUES (
            'virtual-a', 'virtual', 'student', 'contest-a', 'active',
            '2026-01-01', '2026-01-02', NOW()
          )
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Problem" (
            "id", "title", "timeLimitMs", "memoryLimitMb", "updatedAt"
          ) VALUES ('problem-a', 'Problem A', 1000, 256, NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Submission" (
            "id", "userId", "problemId", "courseId", "assessmentId",
            "language", "sourceStoragePrefix", "updatedAt"
          ) VALUES
            ('repair-assignment', 'student', 'problem-a', NULL, 'assignment-a', 'cpp', 'legacy/a/', NOW()),
            ('repair-practice', 'student', 'problem-a', 'course-a', NULL, 'cpp', 'legacy/p/', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Submission" (
            "id", "userId", "problemId", "assessmentId", "participationId",
            "language", "sourceStoragePrefix", "updatedAt"
          ) VALUES (
            'ambiguous-assignment-virtual', 'student', 'problem-a', 'assignment-a',
            'virtual-a', 'cpp', 'legacy/v/', NOW()
          )
        `);
      });

      const blocked = await applyContextMigrations(schema).catch((reason: unknown) => reason);
      expect(blocked).toBeInstanceOf(Error);
      expect((blocked as Error).message).toContain("ambiguous-assignment-virtual");

      await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
        await transaction.$executeRawUnsafe(`
          UPDATE "Submission"
          SET "assessmentId" = NULL, "courseId" = NULL
          WHERE "id" = 'ambiguous-assignment-virtual'
        `);
      });

      await expect(applyContextMigrations(schema)).resolves.toBeUndefined();
      const rows = await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
        return transaction.$queryRawUnsafe<
          {
            id: string;
            assessmentId: string | null;
            courseId: string | null;
            participationId: string | null;
          }[]
        >(`
          SELECT "id", "assessmentId", "courseId", "participationId"
          FROM "Submission"
          ORDER BY "id"
        `);
      });

      expect(rows).toEqual([
        {
          id: "ambiguous-assignment-virtual",
          assessmentId: null,
          courseId: null,
          participationId: "virtual-a",
        },
        {
          id: "repair-assignment",
          assessmentId: "assignment-a",
          courseId: "course-a",
          participationId: null,
        },
        {
          id: "repair-practice",
          assessmentId: null,
          courseId: null,
          participationId: null,
        },
      ]);
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }, 120_000);

  it("upgrades a populated pre-context database without failed Prisma history", async () => {
    const database = `nojv_submission_context_${randomUUID().replaceAll("-", "")}`;
    const url = databaseUrl(database);
    const stage = preContextMigrationStage();
    await testPrisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    const migrationPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });

    try {
      migrate(url, stage);
      await migrationPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`
          INSERT INTO "User" ("id", "email", "name", "updatedAt")
          VALUES
            ('teacher', 'teacher@example.test', 'Teacher', NOW()),
            ('student', 'student@example.test', 'Student', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Course" ("id", "title", "description", "ownerId", "updatedAt")
          VALUES ('course-a', 'Course A', 'Course A description', 'teacher', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Assessment" (
            "id", "courseId", "title", "summary", "opensAt", "closesAt",
            "createdByUserId", "updatedAt"
          ) VALUES (
            'assignment-a', 'course-a', 'Assignment A', 'Assignment A summary',
            '2026-01-01', '2027-01-01', 'teacher', NOW()
          )
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Problem" (
            "id", "title", "timeLimitMs", "memoryLimitMb", "judgeConfig", "updatedAt"
          ) VALUES ('problem-a', 'Problem A', 1000, 256, '{"type":"standard"}', NOW())
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Submission" (
            "id", "userId", "problemId", "courseId", "assessmentId",
            "language", "sourceStorage", "updatedAt"
          ) VALUES
            (
              'repair-assignment', 'student', 'problem-a', NULL, 'assignment-a', 'cpp',
              '{"key":"submissions/repair-assignment/source/manifest.json","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1}',
              NOW()
            ),
            (
              'repair-practice', 'student', 'problem-a', 'course-a', NULL, 'cpp',
              '{"key":"submissions/repair-practice/source/manifest.json","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1}',
              NOW()
            )
        `);
      });

      expect(migrate(url)).toContain("applied");

      const history = await migrationPrisma.$queryRaw<
        { migration_name: string; finished: boolean; rolled_back: boolean }[]
      >`
        SELECT
          migration_name,
          finished_at IS NOT NULL AS finished,
          rolled_back_at IS NOT NULL AS rolled_back
        FROM "_prisma_migrations"
        WHERE migration_name = ANY(${CONTEXT_MIGRATIONS}::text[])
           OR finished_at IS NULL
           OR rolled_back_at IS NOT NULL
        ORDER BY migration_name
      `;
      expect(history).toEqual(
        CONTEXT_MIGRATIONS.map((migration_name) => ({
          migration_name,
          finished: true,
          rolled_back: false,
        })),
      );
      expect(migrate(url)).toContain("No pending migrations to apply");

      const indexes = await migrationPrisma.$queryRaw<
        { index_name: string; ready: boolean; valid: boolean }[]
      >`
        SELECT index_row.relname AS index_name, index_state.indisready AS ready,
               index_state.indisvalid AS valid
        FROM pg_index AS index_state
        JOIN pg_class AS index_row ON index_row.oid = index_state.indexrelid
        WHERE index_row.relname IN (
          'Assessment_id_courseId_key',
          'Participation_id_userId_key'
        )
        ORDER BY index_row.relname
      `;
      expect(indexes).toEqual([
        { index_name: "Assessment_id_courseId_key", ready: true, valid: true },
        { index_name: "Participation_id_userId_key", ready: true, valid: true },
      ]);

      const rows = await migrationPrisma.$queryRaw<
        { id: string; assessmentId: string | null; courseId: string | null }[]
      >`
        SELECT "id", "assessmentId", "courseId"
        FROM "Submission"
        ORDER BY "id"
      `;
      expect(rows).toEqual([
        { id: "repair-assignment", assessmentId: "assignment-a", courseId: "course-a" },
        { id: "repair-practice", assessmentId: null, courseId: null },
      ]);
    } finally {
      rmSync(stage, { recursive: true, force: true });
      await migrationPrisma.$disconnect();
      await testPrisma.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${database}' AND pid <> pg_backend_pid()
      `);
      await testPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`);
    }
  }, 120_000);
});
