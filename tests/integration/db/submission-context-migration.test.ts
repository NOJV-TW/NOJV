import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";

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
const CONTEXT_MIGRATION = "20260716000013_submission_context_invariants";

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
          query(sql: string): Promise<unknown>;
          release(): void;
        }>;
      };
    }
  ).underlyingDriver();
  const connection = await pool.connect();
  try {
    await connection.query(`SET search_path TO "${schema}", public`);
    for (const statement of splitStatements(sql)) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
    await adapter.dispose();
  }
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

      const blocked = await applyMigration(schema, CONTEXT_MIGRATION).catch(
        (reason: unknown) => reason,
      );
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

      await expect(applyMigration(schema, CONTEXT_MIGRATION)).resolves.toBeUndefined();
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
});
