import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { testPrisma } from "../../fixtures/factories";

it("backfills mixed standard/Advanced allocations losslessly and leaves raw records untouched", async () => {
  const sql = await readFile(
    new URL(
      "../../../packages/db/prisma/migrations/20260908000001_activity_problem_weights/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await testPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("CREATE SCHEMA weights_migration_test");
    await tx.$executeRawUnsafe("SET LOCAL search_path TO weights_migration_test");
    const setup = [
      'CREATE TABLE "Problem" (id text, type text, "advancedConfig" jsonb)',
      'CREATE TABLE "TestcaseSet" ("problemId" text, weight int)',
      'CREATE TABLE "Assessment" (id text)',
      'CREATE TABLE "Exam" (id text)',
      'CREATE TABLE "AssessmentProblem" ("assessmentId" text, "problemId" text, points int DEFAULT 100)',
      'CREATE TABLE "ExamProblem" ("examId" text, "problemId" text, points int DEFAULT 100)',
      'CREATE TABLE "Participation" (score int)',
      'CREATE TABLE "Submission" (score int)',
      'CREATE TABLE "ScoreOverride" ("overrideScore" int)',
      `INSERT INTO "Problem" VALUES ('a', 'full_source', NULL), ('b', 'special_env', '{"maxScore":240}')`,
      `INSERT INTO "TestcaseSet" VALUES ('a', 80), ('a', 120)`,
      `INSERT INTO "Assessment" VALUES ('homework'), ('empty')`,
      `INSERT INTO "Exam" VALUES ('exam')`,
      `INSERT INTO "AssessmentProblem" VALUES ('homework', 'a', 100), ('homework', 'b', 100)`,
      `INSERT INTO "ExamProblem" VALUES ('exam', 'a', 100), ('exam', 'b', 100)`,
      'INSERT INTO "Participation" VALUES (280)',
      'INSERT INTO "Submission" VALUES (160)',
      'INSERT INTO "ScoreOverride" VALUES (120)',
    ];
    for (const statement of setup) await tx.$executeRawUnsafe(statement);
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s && s !== "BEGIN" && s !== "COMMIT"))
      await tx.$executeRawUnsafe(statement);
    const rows = await tx.$queryRawUnsafe<{ id: string; totalPoints: unknown }[]>(
      'SELECT * FROM "Assessment" ORDER BY id',
    );
    expect(rows.map((r) => [r.id, Number(r.totalPoints)])).toEqual([
      ["empty", 100],
      ["homework", 440],
    ]);
    expect(await tx.$queryRawUnsafe('SELECT "detachedProblemIds" FROM "Assessment"')).toEqual([
      { detachedProblemIds: [] },
      { detachedProblemIds: [] },
    ]);
    expect(
      await tx.$queryRawUnsafe(
        `SELECT to_regclass('weights_migration_test."GradingAuditLog"')::text AS name`,
      ),
    ).toEqual([{ name: null }]);
    const exam = await tx.$queryRawUnsafe<{ total: unknown; score: unknown }[]>(
      `SELECT e."totalPoints" total, 160.0/200*a.points + 120.0/240*b.points score FROM "Exam" e JOIN "ExamProblem" a ON a."examId"=e.id AND a."problemId"='a' JOIN "ExamProblem" b ON b."examId"=e.id AND b."problemId"='b'`,
    );
    expect(exam.map((r) => [Number(r.total), Number(r.score)])).toEqual([[440, 280]]);
    expect(await tx.$queryRawUnsafe('SELECT score FROM "Submission"')).toEqual([
      { score: 160 },
    ]);
    expect(await tx.$queryRawUnsafe('SELECT "overrideScore" FROM "ScoreOverride"')).toEqual([
      { overrideScore: 120 },
    ]);
    await tx.$executeRawUnsafe("DROP SCHEMA weights_migration_test CASCADE");
  });
});
