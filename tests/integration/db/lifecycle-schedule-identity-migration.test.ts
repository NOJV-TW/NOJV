import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { testPrisma } from "../../fixtures/factories";
import { splitStatements } from "../../setup/replay-constraints";

const MIGRATIONS = [
  "20260716000009_lifecycle_schedule_identity_expand",
  "20260716000010_lifecycle_schedule_identity_contract",
];

async function createLifecycleTables(schema: string): Promise<void> {
  await testPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await testPrisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await transaction.$executeRawUnsafe(
      `CREATE TYPE "ExamStatus" AS ENUM ('draft', 'published')`,
    );
    await transaction.$executeRawUnsafe(
      `CREATE TYPE "ContestVisibility" AS ENUM ('draft', 'published')`,
    );
    await transaction.$executeRawUnsafe(
      `CREATE TYPE "AssessmentStatus" AS ENUM ('draft', 'published')`,
    );
    await transaction.$executeRawUnsafe(
      `CREATE TYPE "ScoreboardMode" AS ENUM ('hidden', 'live', 'frozen')`,
    );
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Exam" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT NOT NULL,
        "status" "ExamStatus" NOT NULL,
        "startsAt" TIMESTAMP(3) NOT NULL,
        "endsAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Contest" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT NOT NULL,
        "visibility" "ContestVisibility" NOT NULL,
        "scoreboardMode" "ScoreboardMode" NOT NULL,
        "startsAt" TIMESTAMP(3) NOT NULL,
        "endsAt" TIMESTAMP(3) NOT NULL,
        "frozenAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Assessment" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT NOT NULL,
        "status" "AssessmentStatus" NOT NULL,
        "opensAt" TIMESTAMP(3) NOT NULL,
        "closesAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

async function applyMigration(schema: string, migration: string): Promise<void> {
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

describe("lifecycle schedule identity migrations", () => {
  it("backfills identities and enforces DB-owned monotonic timer revisions", async () => {
    const schema = `lifecycle_${randomUUID().replaceAll("-", "")}`;
    await createLifecycleTables(schema);

    try {
      await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Exam" ("id", "title", "status", "startsAt", "endsAt")
          VALUES ('exam_1', 'Exam', 'published', '2030-01-01 09:00', '2030-01-01 10:00')
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Contest" (
            "id", "title", "visibility", "scoreboardMode", "startsAt", "endsAt"
          ) VALUES (
            'contest_1', 'Contest', 'draft', 'live', '2030-01-02 09:00', '2030-01-02 10:00'
          )
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Assessment" ("id", "title", "status", "opensAt", "closesAt")
          VALUES ('assignment_1', 'Assignment', 'draft', '2030-01-03 09:00', '2030-01-03 10:00')
        `);
      });

      for (const migration of MIGRATIONS) await applyMigration(schema, migration);

      await testPrisma.$executeRawUnsafe(`
        INSERT INTO "${schema}"."Exam" (
          "id", "title", "status", "startsAt", "endsAt"
        ) VALUES (
          'exam_2', 'New draft', 'draft', '2031-01-01 09:00', '2031-01-01 10:00'
        )
      `);
      const inserted = await testPrisma.$queryRawUnsafe<
        { scheduleRevision: number; timerFingerprint: string }[]
      >(
        `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Exam" WHERE "id" = 'exam_2'`,
      );
      expect(inserted[0]).toMatchObject({ scheduleRevision: 0 });
      expect(inserted[0]?.timerFingerprint).toMatch(/^exam:v1:exam_2:/);

      const initial = await testPrisma.$queryRawUnsafe<
        { scheduleRevision: number; timerFingerprint: string }[]
      >(
        `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Exam" WHERE "id" = 'exam_1'`,
      );
      expect(initial[0]).toMatchObject({ scheduleRevision: 1 });
      expect(initial[0]?.timerFingerprint).toMatch(/^exam:v1:exam_1:/);

      await testPrisma.$executeRawUnsafe(
        `UPDATE "${schema}"."Exam" SET "title" = 'Renamed', "scheduleRevision" = 99 WHERE "id" = 'exam_1'`,
      );
      const afterTitle = await testPrisma.$queryRawUnsafe<
        { scheduleRevision: number; timerFingerprint: string }[]
      >(
        `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Exam" WHERE "id" = 'exam_1'`,
      );
      expect(afterTitle[0]).toEqual(initial[0]);

      await testPrisma.$executeRawUnsafe(
        `UPDATE "${schema}"."Exam" SET "endsAt" = '2030-01-01 11:00' WHERE "id" = 'exam_1'`,
      );
      const afterTimer = await testPrisma.$queryRawUnsafe<
        { scheduleRevision: number; timerFingerprint: string }[]
      >(
        `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Exam" WHERE "id" = 'exam_1'`,
      );
      expect(afterTimer[0]?.scheduleRevision).toBe(2);
      expect(afterTimer[0]?.timerFingerprint).not.toBe(initial[0]?.timerFingerprint);

      const contestBefore = await testPrisma.$queryRawUnsafe<
        { scheduleRevision: number; timerFingerprint: string }[]
      >(
        `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Contest" WHERE "id" = 'contest_1'`,
      );
      await testPrisma.$executeRawUnsafe(
        `UPDATE "${schema}"."Contest" SET "title" = 'Renamed', "scheduleRevision" = 99 WHERE "id" = 'contest_1'`,
      );
      expect(
        await testPrisma.$queryRawUnsafe(
          `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Contest" WHERE "id" = 'contest_1'`,
        ),
      ).toEqual(contestBefore);
      await testPrisma.$executeRawUnsafe(
        `UPDATE "${schema}"."Contest" SET "frozenAt" = '2030-01-02 09:30' WHERE "id" = 'contest_1'`,
      );
      const contestAfterTimer = await testPrisma.$queryRawUnsafe<
        { scheduleRevision: number; timerFingerprint: string }[]
      >(
        `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Contest" WHERE "id" = 'contest_1'`,
      );
      expect(contestAfterTimer[0]?.scheduleRevision).toBe(1);
      expect(contestAfterTimer[0]?.timerFingerprint).not.toBe(
        contestBefore[0]?.timerFingerprint,
      );

      const assessmentBefore = await testPrisma.$queryRawUnsafe<
        { scheduleRevision: number; timerFingerprint: string }[]
      >(
        `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Assessment" WHERE "id" = 'assignment_1'`,
      );
      await testPrisma.$executeRawUnsafe(
        `UPDATE "${schema}"."Assessment" SET "closesAt" = '2030-01-03 11:00' WHERE "id" = 'assignment_1'`,
      );
      const assessmentAfterTimer = await testPrisma.$queryRawUnsafe<
        { scheduleRevision: number; timerFingerprint: string }[]
      >(
        `SELECT "scheduleRevision", "timerFingerprint" FROM "${schema}"."Assessment" WHERE "id" = 'assignment_1'`,
      );
      expect(assessmentAfterTimer[0]?.scheduleRevision).toBe(1);
      expect(assessmentAfterTimer[0]?.timerFingerprint).not.toBe(
        assessmentBefore[0]?.timerFingerprint,
      );
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("aborts contract cutover when the expanded identity is corrupt", async () => {
    const schema = `lifecycle_dirty_${randomUUID().replaceAll("-", "")}`;
    await createLifecycleTables(schema);

    try {
      await applyMigration(schema, MIGRATIONS[0]);
      await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await transaction.$executeRawUnsafe(
          `ALTER TABLE "Exam" DISABLE TRIGGER exam_lifecycle_schedule_identity`,
        );
        await transaction.$executeRawUnsafe(`
          INSERT INTO "Exam" (
            "id", "title", "status", "startsAt", "endsAt", "timerFingerprint"
          ) VALUES (
            'exam_bad', 'Bad', 'draft', '2030-01-01 09:00', '2030-01-01 10:00', NULL
          )
        `);
        await transaction.$executeRawUnsafe(
          `ALTER TABLE "Exam" ENABLE TRIGGER exam_lifecycle_schedule_identity`,
        );
      });

      const error = await applyMigration(schema, MIGRATIONS[1]).catch(
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("exam_bad");
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
