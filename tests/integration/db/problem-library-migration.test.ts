import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";

import { adjustmentRulesSchema } from "@nojv/core";
import { PrismaClient } from "../../../packages/db/generated/prisma/client";
import { testPrisma } from "../../fixtures/factories";
import {
  assertLiveTestDatabase,
  resolveConfiguredDestructiveTestDatabase,
} from "../../setup/destructive-test-database";
import { splitStatements } from "../../setup/replay-constraints";

const repoRoot = process.cwd();
const migrations = join(repoRoot, "packages/db/prisma/migrations");
const lateMigration = "20260908000000_exam_late_submission_policy";
const libraryMigration = "20260908000002_course_problem_permissions";

function preflightSql(migration: string): string {
  return splitStatements(
    readFileSync(join(migrations, migration, "migration.sql"), "utf8"),
  ).find((statement) => statement.startsWith("DO $$"))!;
}

async function expectFailedMigration(
  db: PrismaClient,
  migration: string,
  result: { status: number | null; output: string },
) {
  expect(result.status, result.output).not.toBe(0);
  expect(
    await db.$queryRaw`
    SELECT finished_at IS NULL AS unfinished, applied_steps_count
    FROM "_prisma_migrations" WHERE migration_name = ${migration} AND rolled_back_at IS NULL
  `,
  ).toEqual([{ unfinished: true, applied_steps_count: 0 }]);
}

async function rehearse(
  target: string,
  check: (
    db: PrismaClient,
    command: (...args: string[]) => { status: number | null; output: string },
  ) => Promise<void>,
) {
  const configured = resolveConfiguredDestructiveTestDatabase();
  await assertLiveTestDatabase(testPrisma, configured.expectedDatabase);
  const database = `nojv_problem_upgrade_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(configured.databaseUrl);
  url.pathname = `/${database}`;
  const stage = mkdtempSync(join(tmpdir(), "nojv-problem-migrations-"));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  const command = (...args: string[]) => {
    const result = spawnSync(
      "pnpm",
      ["--filter", "@nojv/db", "exec", "prisma", "migrate", ...args],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, DATABASE_URL: url.toString(), PRISMA_MIGRATIONS_PATH: stage },
      },
    );
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  };
  try {
    await testPrisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    cpSync(join(migrations, "migration_lock.toml"), join(stage, "migration_lock.toml"));
    for (const entry of readdirSync(migrations, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name < target) {
        cpSync(join(migrations, entry.name), join(stage, entry.name), { recursive: true });
      }
    }
    const baseline = command("deploy");
    expect(baseline.status, baseline.output).toBe(0);
    await seed(db);
    cpSync(join(migrations, target), join(stage, target), { recursive: true });
    await check(db, command);
  } finally {
    await db.$disconnect();
    await assertLiveTestDatabase(testPrisma, configured.expectedDatabase);
    await testPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    rmSync(stage, { recursive: true, force: true });
  }
}

async function execute(db: PrismaClient, fixtureSql: string) {
  await db.$transaction(async (tx) => {
    for (const statement of splitStatements(fixtureSql)) await tx.$executeRawUnsafe(statement);
  });
}

async function seed(db: PrismaClient) {
  await execute(
    db,
    `
    INSERT INTO "User" ("id", "username", "email", "name", "updatedAt")
    SELECT id, id, id || '@test.local', id, NOW() FROM unnest(ARRAY['teacher','owner','student']) id;
    INSERT INTO "Course" ("id", "title", "description", "ownerId", "updatedAt")
    SELECT id, id, '', 'teacher', NOW() FROM unnest(ARRAY['course_a','course_b']) id;
    INSERT INTO "CourseMembership" ("id", "courseId", "userId", "role", "updatedAt")
    VALUES ('membership', 'course_a', 'student', 'student', NOW());
    INSERT INTO "Problem" ("id", "title", "authorId", "visibility", "status", "timeLimitMs", "memoryLimitMb", "updatedAt")
    SELECT id, id, 'owner', CASE WHEN id = 'public' THEN 'public' ELSE 'private' END::"ProblemVisibility",
      CASE WHEN id = 'public' THEN 'published' ELSE 'draft' END::"ProblemStatus", 1000, 128, NOW()
    FROM unnest(ARRAY['public','private','history_exam','history_assignment','personal','contest_only']) id;
    UPDATE "Problem" SET "forkedFromProblemId" = 'public' WHERE "id" = 'private';
    INSERT INTO "Assessment" ("id", "courseId", "title", "summary", "opensAt", "dueAt", "closesAt", "createdByUserId", "updatedAt")
    VALUES ('assignment', 'course_a', 'Assignment', '', '2030-01-01', '2030-01-02', '2030-01-04', 'teacher', NOW());
    INSERT INTO "Exam" ("id", "courseId", "title", "summary", "startsAt", "endsAt", "updatedAt")
    VALUES ('exam_a', 'course_a', 'Exam A', '', '2030-01-01', '2030-01-04', NOW()),
      ('exam_b', 'course_b', 'Exam B', '', '2030-01-01', '2030-01-04', NOW());
    INSERT INTO "AssessmentProblem" ("id", "assessmentId", "problemId", "ordinal", "points")
    VALUES ('ap_private', 'assignment', 'private', 1, 83), ('ap_public', 'assignment', 'public', 2, 91);
    INSERT INTO "ExamProblem" ("id", "examId", "problemId", "ordinal", "points")
    VALUES ('ep_private', 'exam_a', 'private', 1, 77), ('ep_public', 'exam_b', 'public', 1, 88);
    INSERT INTO "Contest" ("id", "title", "summary", "startsAt", "endsAt", "updatedAt")
    VALUES ('contest', 'Contest', '', '2030-01-01', '2030-01-04', NOW());
    INSERT INTO "Submission" ("id", "userId", "problemId", "courseId", "assessmentId", "examId", "contestId", "language", "status", "score", "updatedAt")
    VALUES ('s_assignment', 'student', 'history_assignment', 'course_a', 'assignment', NULL, NULL, 'cpp', 'pending_upload', 83, NOW()),
      ('s_exam', 'student', 'history_exam', NULL, NULL, 'exam_b', NULL, 'cpp', 'pending_upload', 91, NOW()),
      ('s_exam_duplicate', 'student', 'history_exam', NULL, NULL, 'exam_b', NULL, 'cpp', 'pending_upload', 77, NOW()),
      ('s_practice', 'student', 'personal', NULL, NULL, NULL, NULL, 'cpp', 'pending_upload', 42, NOW()),
      ('s_contest', 'student', 'contest_only', NULL, NULL, NULL, 'contest', 'cpp', 'pending_upload', 88, NOW());
    INSERT INTO "ScoreOverride" ("id", "courseMembershipId", "problemId", "contextType", "contextId", "overrideScore", "reason", "createdByUserId", "updatedAt")
    VALUES ('override', 'membership', 'private', 'assignment', 'assignment', 93, 'Reviewed', 'teacher', NOW());
    INSERT INTO "SubmissionFeedback" ("id", "courseMembershipId", "problemId", "assessmentId", "comment", "authorUserId", "updatedAt")
    VALUES ('feedback', 'membership', 'private', 'assignment', 'Preserve feedback', 'teacher', NOW());
    INSERT INTO "ScoreOverrideAuditLog" ("id", "overrideId", "courseMembershipId", "problemId", "contextType", "contextId", "action", "newScore")
    VALUES ('score_audit', 'override', 'membership', 'private', 'assignment', 'assignment', 'create', 93);
    INSERT INTO "SubmissionFeedbackAuditLog" ("id", "feedbackId", "courseMembershipId", "problemId", "assessmentId", "action", "newComment")
    VALUES ('feedback_audit', 'feedback', 'membership', 'private', 'assignment', 'create', 'Preserve feedback');
  `,
  );
}

async function snapshot(db: PrismaClient) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('_prisma_migrations', 'CourseProblem') ORDER BY tablename
  `;
  return Object.fromEntries(
    await Promise.all(
      tables.map(async ({ tablename }) => {
        const rows = await db.$queryRawUnsafe<{ row: Record<string, unknown> }[]>(
          `SELECT to_jsonb(t) AS row FROM "${tablename.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`,
        );
        return [tablename, rows.map(({ row }) => row)] as const;
      }),
    ),
  );
}

async function examColumns(db: PrismaClient) {
  return db.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Exam' ORDER BY ordinal_position
  `;
}

const bonus = {
  type: "time_bonus",
  baselineMs: 1000,
  maxBonusPercent: 10,
  startFrom: "final_day",
  legacyNote: "ignored by both bonus validators",
};
const flat = { type: "flat_late_penalty", penaltyPct: 20 };
const daily = { type: "daily_late_penalty", perDayPct: 10 };
const legacy = [
  bonus,
  { ...flat, startFrom: "due" },
  { ...daily, startFrom: "final_day", legacyNote: "retired" },
  { type: "final_day_zero", legacyNote: "retired" },
];

describe("problem library release through unmodified Prisma migrations", () => {
  it("fails closed on unsupported policies, rolls back late DDL and data, then resolves and reruns", async () => {
    await rehearse(lateMigration, async (db, command) => {
      const setRules = (rules: unknown) => db.$executeRaw`
        UPDATE "Assessment" SET "adjustmentRules" = ${JSON.stringify(rules)}::jsonb WHERE "id" = 'assignment'
      `;
      const columns = await examColumns(db);
      for (const rules of [
        [flat, daily],
        [flat, flat],
        {},
        [null],
        [{ type: "unknown" }],
        [{ ...flat, startFrom: "tomorrow" }],
        [{ ...flat, startFrom: null }],
        [{ ...flat, penaltyPct: "20" }],
        [{ ...daily, perDayPct: 101 }],
        [{ ...flat, extra: true }],
        [{ ...bonus, baselineMs: -1 }],
        Array(11).fill(bonus),
      ]) {
        await setRules(rules);
        const before = await snapshot(db);
        await expect(db.$executeRawUnsafe(preflightSql(lateMigration))).rejects.toThrow(
          "Late submission policy preflight: Assessment assignment:",
        );
        const failed = command("deploy");
        await expectFailedMigration(db, lateMigration, failed);
        expect(await snapshot(db)).toEqual(before);
        expect(await examColumns(db)).toEqual(columns);
        const resolved = command("resolve", "--rolled-back", lateMigration);
        expect(resolved.status, resolved.output).toBe(0);
      }
      const supported = [
        { id: "sql_null", due: "2030-01-02", rules: null, expected: null },
        { id: "json_null", due: "2030-01-02", rules: null, expected: null },
        { id: "empty", due: "2030-01-02", rules: [], expected: [] },
        { id: "no_due", due: null, rules: [flat, bonus, daily], expected: [bonus] },
        {
          id: "no_late_window",
          due: "2030-01-04",
          rules: [flat, bonus, daily],
          expected: [bonus],
        },
        { id: "daily", due: "2030-01-02", rules: [daily, bonus], expected: [daily, bonus] },
      ];
      for (const { id, due, rules } of supported) {
        await db.$executeRaw`
          INSERT INTO "Assessment" ("id", "courseId", "title", "summary", "opensAt", "dueAt", "closesAt", "createdByUserId", "updatedAt", "adjustmentRules")
          VALUES (${id}, 'course_a', ${id}, '', '2030-01-01', ${due}::timestamp, '2030-01-04', 'teacher', NOW(), ${JSON.stringify(rules)}::jsonb)
        `;
      }
      await db.$executeRawUnsafe(
        `UPDATE "Assessment" SET "adjustmentRules" = NULL WHERE "id" = 'sql_null'`,
      );
      await setRules(legacy);
      await db.$executeRawUnsafe(
        'ALTER TABLE "Exam" ADD CONSTRAINT "Exam_dueAt_window_check" CHECK (true)',
      );
      const before = await snapshot(db);
      const failed = command("deploy");
      await expectFailedMigration(db, lateMigration, failed);
      expect(await snapshot(db)).toEqual(before);
      expect(await examColumns(db)).toEqual(columns);
      const blocked = command("deploy");
      expect(blocked.status, blocked.output).not.toBe(0);
      expect(blocked.output).toContain("P3009");
      await db.$executeRawUnsafe(
        'ALTER TABLE "Exam" DROP CONSTRAINT "Exam_dueAt_window_check"',
      );
      expect(command("resolve", "--rolled-back", lateMigration).status).toBe(0);
      const applied = command("deploy");
      expect(applied.status, applied.output).toBe(0);
      const rows = await db.$queryRaw<
        { adjustmentRules: unknown }[]
      >`SELECT "adjustmentRules" FROM "Assessment" WHERE "id" = 'assignment'`;
      expect(rows[0]?.adjustmentRules).toEqual([bonus, flat]);
      expect(adjustmentRulesSchema.safeParse(rows[0]?.adjustmentRules).success).toBe(true);
      const expected = {
        ...before,
        Assessment: before.Assessment!.map((row) => ({
          ...row,
          adjustmentRules:
            row.id === "assignment"
              ? [bonus, flat]
              : supported.find(({ id }) => row.id === id)!.expected,
        })),
        Exam: before.Exam!.map((row) => ({ ...row, dueAt: null, adjustmentRules: null })),
      };
      expect(await snapshot(db)).toEqual(expected);
      expect(
        await db.$queryRaw`
        SELECT "id", "adjustmentRules" IS NULL AS sql_null FROM "Assessment"
        WHERE "id" IN ('sql_null', 'json_null') ORDER BY "id"
      `,
      ).toEqual([
        { id: "json_null", sql_null: false },
        { id: "sql_null", sql_null: true },
      ]);
      const rerun = command("deploy");
      expect(rerun.status, rerun.output).toBe(0);
      expect(rerun.output).toContain("No pending migrations to apply");
      expect(await snapshot(db)).toEqual(expected);
      for (const due of ["2030-01-01", "2030-01-05"]) {
        await expect(
          db.$executeRaw`UPDATE "Exam" SET "dueAt" = ${due}::timestamp WHERE "id" = 'exam_a'`,
        ).rejects.toThrow(/Exam_dueAt_window_check/);
      }
    });
  }, 180_000);

  it("preserves every old row and exact historical pairs, rejects missing owners, and enforces the new contract", async () => {
    await rehearse(libraryMigration, async (db, command) => {
      await db.$executeRawUnsafe(
        `UPDATE "Problem" SET "authorId" = NULL WHERE "id" = 'personal'`,
      );
      const beforeFailure = await snapshot(db);
      await expect(db.$executeRawUnsafe(preflightSql(libraryMigration))).rejects.toThrow(
        "require an existing owner: Problem personal",
      );
      const failed = command("deploy");
      await expectFailedMigration(db, libraryMigration, failed);
      expect(await snapshot(db)).toEqual(beforeFailure);
      expect(
        await db.$queryRaw`SELECT to_regclass('public."CourseProblem"')::text AS name`,
      ).toEqual([{ name: null }]);
      await db.$executeRawUnsafe(
        `UPDATE "Problem" SET "authorId" = 'owner' WHERE "id" = 'personal'`,
      );
      expect(command("resolve", "--rolled-back", libraryMigration).status).toBe(0);

      await execute(
        db,
        `
        CREATE FUNCTION reject_library_backfill() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF to_regclass('public."CourseProblem"') IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'injected_backfill_failure') THEN
            EXECUTE 'ALTER TABLE "CourseProblem" ADD CONSTRAINT injected_backfill_failure CHECK (false)';
          END IF;
        END $$;
        CREATE EVENT TRIGGER reject_library_backfill ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION reject_library_backfill();
      `,
      );
      const before = await snapshot(db);
      const lateFailure = command("deploy");
      await expectFailedMigration(db, libraryMigration, lateFailure);
      expect(await snapshot(db)).toEqual(before);
      expect(
        await db.$queryRaw`SELECT to_regclass('public."CourseProblem"')::text AS name`,
      ).toEqual([{ name: null }]);
      expect(
        await db.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Problem' AND column_name = 'authorId'`,
      ).toEqual([{ is_nullable: "YES" }]);
      expect(
        await db.$queryRaw`SELECT confdeltype::text AS action FROM pg_constraint WHERE conname = 'Problem_authorId_fkey'`,
      ).toEqual([{ action: "n" }]);
      await execute(
        db,
        "DROP EVENT TRIGGER reject_library_backfill; DROP FUNCTION reject_library_backfill()",
      );
      expect(command("resolve", "--rolled-back", libraryMigration).status).toBe(0);
      const applied = command("deploy");
      expect(applied.status, applied.output).toBe(0);
      expect(await snapshot(db)).toEqual(before);
      expect(
        await db.$queryRaw`
        SELECT conname, confdeltype::text AS action FROM pg_constraint
        WHERE conname IN ('Problem_authorId_fkey', 'CourseProblem_courseId_fkey', 'CourseProblem_problemId_fkey', 'CourseProblem_addedByUserId_fkey')
        ORDER BY conname
      `,
      ).toEqual([
        { conname: "CourseProblem_addedByUserId_fkey", action: "n" },
        { conname: "CourseProblem_courseId_fkey", action: "c" },
        { conname: "CourseProblem_problemId_fkey", action: "r" },
        { conname: "Problem_authorId_fkey", action: "r" },
      ]);
      const pairs = await db.courseProblem.findMany({
        orderBy: [{ courseId: "asc" }, { problemId: "asc" }],
      });
      expect(
        pairs.map(({ courseId, problemId, addedByUserId }) => [
          courseId,
          problemId,
          addedByUserId,
        ]),
      ).toEqual([
        ["course_a", "history_assignment", null],
        ["course_a", "private", null],
        ["course_a", "public", null],
        ["course_b", "history_exam", null],
        ["course_b", "public", null],
      ]);
      expect(pairs.every(({ createdAt }) => createdAt instanceof Date)).toBe(true);
      const rerun = command("deploy");
      expect(rerun.status, rerun.output).toBe(0);
      expect(rerun.output).toContain("No pending migrations to apply");
      expect(
        await db.courseProblem.findMany({
          orderBy: [{ courseId: "asc" }, { problemId: "asc" }],
        }),
      ).toEqual(pairs);
      for (const sql of [
        `UPDATE "Problem" SET "authorId" = NULL WHERE "id" = 'personal'`,
        `DELETE FROM "User" WHERE "id" = 'owner'`,
        `DELETE FROM "Problem" WHERE "id" = 'history_exam'`,
        `INSERT INTO "CourseProblem" ("courseId", "problemId") VALUES ('course_a', 'private')`,
        `INSERT INTO "CourseProblem" ("courseId", "problemId") VALUES ('missing', 'personal')`,
        `INSERT INTO "CourseProblem" ("courseId", "problemId") VALUES ('course_a', 'missing')`,
        `INSERT INTO "CourseProblem" ("courseId", "problemId", "addedByUserId") VALUES ('course_a', 'personal', 'missing')`,
      ])
        await expect(db.$executeRawUnsafe(sql)).rejects.toThrow();
      expect(await snapshot(db)).toEqual(before);
      expect(
        await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
      ).toEqual([{ count: 0 }]);
    });
  }, 180_000);
});
