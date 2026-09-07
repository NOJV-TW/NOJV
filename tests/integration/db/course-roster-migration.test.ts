import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "../../../packages/db/generated/prisma/client";
import { testPrisma } from "../../fixtures/factories";
import { splitStatements } from "../../setup/replay-constraints";

const migrations = join(process.cwd(), "packages/db/prisma/migrations");
const contract = "20260907000000_course_roster_contract";
const baseline = readdirSync(migrations, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name < contract)
  .map((entry) => entry.name)
  .sort();
let schema: string;

function inSchema<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
      return run(tx);
    },
    { timeout: 60_000 },
  );
}

async function execute(sql: string): Promise<void> {
  await inSchema(async (tx) => {
    for (const statement of splitStatements(sql)) {
      await tx.$executeRawUnsafe(statement);
    }
  });
}

async function applyMigration(name: string): Promise<void> {
  const sql = readFileSync(join(migrations, name, "migration.sql"), "utf8").replaceAll(
    '"public".',
    `"${schema}".`,
  );
  await inSchema(async (tx) => {
    for (const statement of splitStatements(sql)) {
      // Each migration uses this isolated transaction; no shared-schema DDL.
      if (
        /^(BEGIN|COMMIT)$/.test(statement) ||
        statement === 'CREATE SCHEMA IF NOT EXISTS "public"'
      )
        continue;
      await tx.$executeRawUnsafe(statement.replace(/\bCONCURRENTLY\s+/g, ""));
    }
  });
}

type Row = Record<string, unknown>;
async function rows(table: string): Promise<Row[]> {
  return inSchema(async (tx) => {
    const result = await tx.$queryRawUnsafe<{ row: Row }[]>(
      `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY "id"`,
    );
    return result.map(({ row }) => row);
  });
}

async function snapshot() {
  const tables = [
    "User",
    "CourseMembership",
    "ScoreOverride",
    "SubmissionFeedback",
    "ScoreOverrideAuditLog",
    "SubmissionFeedbackAuditLog",
  ];
  return Promise.all(tables.map(rows));
}

beforeEach(async () => {
  schema = `roster_upgrade_${randomUUID().replaceAll("-", "")}`;
  await testPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for (const name of baseline) await applyMigration(name);
  await execute(`
    INSERT INTO "User" ("id", "username", "email", "name", "platformRole", "updatedAt")
    VALUES ('teacher', 'teacher', 'teacher@test.local', 'Teacher', 'teacher', '2026-01-01'),
      ('real', 'real', 'real@test.local', 'Real Student', 'student', '2026-01-01');
    INSERT INTO "User" ("id", "username", "email", "name", "status", "updatedAt")
    SELECT 'pending_' || n, 'roster_' || n,
      'placeholder+roster_' || n || '@placeholder.nojv.local', 'roster_' || n,
      'pending_first_login', '2026-01-02'::timestamp
    FROM generate_series(1, 8) n;
    INSERT INTO "Course" ("id", "title", "description", "ownerId", "updatedAt")
    VALUES ('course_1', 'Course 1', '', 'teacher', '2026-01-03'),
      ('course_2', 'Course 2', '', 'teacher', '2026-01-03');
    INSERT INTO "CourseMembership" ("id", "courseId", "userId", "role", "status", "addedByUserId", "joinedAt", "removedAt", "createdAt", "updatedAt")
    SELECT 'membership_' || n, CASE WHEN n = 8 THEN 'course_2' ELSE 'course_1' END,
      'pending_' || n, CASE WHEN n = 8 THEN 'ta' ELSE 'student' END::"CourseRole",
      CASE WHEN n = 7 THEN 'removed' ELSE 'active' END::"CourseMembershipStatus",
      'teacher', '2026-01-04'::timestamp,
      CASE WHEN n = 7 THEN '2026-01-08'::timestamp ELSE NULL END,
      '2026-01-04'::timestamp, '2026-01-08'::timestamp
    FROM generate_series(1, 8) n;
    INSERT INTO "CourseMembership" ("id", "courseId", "userId", "role", "addedByUserId", "updatedAt")
    VALUES ('membership_real', 'course_1', 'real', 'student', 'teacher', '2026-01-04');
    INSERT INTO "Problem" ("id", "title", "authorId", "timeLimitMs", "memoryLimitMb", "updatedAt")
    VALUES ('problem', 'Problem', 'teacher', 1000, 128, '2026-01-04');
    INSERT INTO "Assessment" ("id", "courseId", "title", "summary", "opensAt", "closesAt", "createdByUserId", "updatedAt")
    VALUES ('assignment', 'course_1', 'Assignment', '', '2026-01-05', '2026-01-06', 'teacher', '2026-01-05');
    INSERT INTO "Exam" ("id", "courseId", "title", "summary", "startsAt", "endsAt", "updatedAt")
    VALUES ('exam', 'course_1', 'Exam', '', '2026-01-05', '2026-01-06', '2026-01-05');
    INSERT INTO "Contest" ("id", "title", "summary", "startsAt", "endsAt", "updatedAt")
    VALUES ('contest', 'Contest', '', '2026-01-05', '2026-01-06', '2026-01-05');
    INSERT INTO "ScoreOverride" ("id", "userId", "problemId", "contextType", "contextId", "overrideScore", "reason", "createdByUserId", "updatedAt")
    VALUES ('score_assignment', 'pending_1', 'problem', 'assignment', 'assignment', 80, 'Assignment score', 'teacher', '2026-01-09'),
      ('score_exam', 'pending_2', 'problem', 'exam', 'exam', 90, 'Exam score', 'teacher', '2026-01-09'),
      ('score_removed', 'pending_7', 'problem', 'assignment', 'assignment', 70, 'Removed student', 'teacher', '2026-01-09'),
      ('score_real', 'real', 'problem', 'assignment', 'assignment', 99, 'Real student', 'teacher', '2026-01-09'),
      ('score_contest', 'real', 'problem', 'contest', 'contest', 100, 'Contest score', 'teacher', '2026-01-09');
    INSERT INTO "SubmissionFeedback" ("id", "studentUserId", "problemId", "assessmentId", "examId", "comment", "authorUserId", "updatedAt")
    VALUES ('feedback_assignment', 'pending_1', 'problem', 'assignment', NULL, 'Assignment feedback', 'teacher', '2026-01-10'),
      ('feedback_exam', 'pending_2', 'problem', NULL, 'exam', 'Exam feedback', 'teacher', '2026-01-10'),
      ('feedback_removed', 'pending_7', 'problem', 'assignment', NULL, 'Removed feedback', 'teacher', '2026-01-10');
    INSERT INTO "ScoreOverrideAuditLog" ("id", "overrideId", "userId", "problemId", "contextType", "contextId", "action", "newScore", "newReason", "changedByUserId", "createdAt")
    SELECT 'audit_' || "id", "id", "userId", "problemId", "contextType", "contextId", 'create', "overrideScore", "reason", 'teacher', '2026-01-09'
    FROM "ScoreOverride";
    INSERT INTO "SubmissionFeedbackAuditLog" ("id", "feedbackId", "studentUserId", "problemId", "assessmentId", "examId", "action", "newComment", "changedByUserId", "createdAt")
    SELECT 'audit_' || "id", "id", "studentUserId", "problemId", "assessmentId", "examId", 'create', "comment", 'teacher', '2026-01-10'
    FROM "SubmissionFeedback";
    INSERT INTO "ScoreOverrideAuditLog" ("id", "userId", "problemId", "contextType", "contextId", "action", "oldScore", "oldReason", "changedByUserId")
    VALUES ('deleted_score_audit', 'pending_1', 'deleted_problem', 'assignment', 'deleted_assignment', 'delete', 42, 'Historical score', 'teacher');
    INSERT INTO "SubmissionFeedbackAuditLog" ("id", "studentUserId", "problemId", "examId", "action", "oldComment", "changedByUserId")
    VALUES ('deleted_feedback_audit', 'pending_1', 'deleted_problem', 'deleted_exam', 'delete', 'Historical feedback', 'teacher');
  `);
}, 90_000);

afterEach(async () => {
  await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
});

describe("course roster forward migration rehearsal", () => {
  it("preserves eight memberships, real users, grades, and all historical snapshots", async () => {
    const oldMembers = await rows("CourseMembership");
    const oldUsers = (await rows("User")).filter((row) => row.status === "active");
    const oldScores = await rows("ScoreOverride");
    const oldFeedback = await rows("SubmissionFeedback");
    const oldAudits = await rows("ScoreOverrideAuditLog");
    const oldFeedbackAudits = await rows("SubmissionFeedbackAuditLog");
    await applyMigration(contract);
    await applyMigration("20260907000001_course_roster_audit_indexes");

    const membershipId = (userId: unknown) =>
      oldMembers.find((row) => row.userId === userId)?.id;
    expect(await rows("CourseMembership")).toEqual(
      oldMembers.map((row) => ({
        ...row,
        userId: row.userId === "real" ? "real" : null,
        pendingUsername:
          row.userId === "real" ? null : String(row.userId).replace("pending_", "roster_"),
      })),
    );
    expect(await rows("User")).toEqual(
      oldUsers.map((user) => {
        const row = { ...user };
        delete row.status;
        return row;
      }),
    );
    expect(await rows("ScoreOverride")).toEqual(
      oldScores.map((row) => ({
        ...row,
        userId: row.contextType === "contest" ? row.userId : null,
        courseMembershipId: row.contextType === "contest" ? null : membershipId(row.userId),
      })),
    );
    expect(await rows("SubmissionFeedback")).toEqual(
      oldFeedback.map(({ studentUserId, ...row }) => ({
        ...row,
        courseMembershipId: membershipId(studentUserId),
      })),
    );
    for (const [table, old] of [
      ["ScoreOverrideAuditLog", oldAudits],
      ["SubmissionFeedbackAuditLog", oldFeedbackAudits],
    ] as const) {
      expect(await rows(table)).toEqual(
        old.map((row) => {
          const subject =
            String(row.id).startsWith("deleted_") || row.contextType === "contest"
              ? null
              : membershipId(row.userId ?? row.studentUserId);
          return { ...row, courseMembershipId: subject, sourceMembershipId: subject };
        }),
      );
    }
    expect(await rows("Participation")).toEqual([]);
    expect(await rows("Submission")).toEqual([]);
    const feedbackIndexes = await inSchema(
      (tx) => tx.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = ${schema} AND tablename = 'SubmissionFeedback'
    `,
    );
    expect(feedbackIndexes.map((index) => index.indexname)).toEqual(
      expect.arrayContaining([
        "SubmissionFeedback_assessmentId_problemId_courseMembershipI_key",
        "SubmissionFeedback_examId_problemId_courseMembershipId_key",
      ]),
    );
    expect(feedbackIndexes.some((index) => index.indexdef.includes("studentUserId"))).toBe(
      false,
    );
    await execute(`UPDATE "User" SET "disabled" = true WHERE "id" = 'real'`);
    expect((await rows("User")).find((row) => row.id === "real")?.securityGeneration).toBe(1);
  });

  it.each([
    [
      "Account",
      `INSERT INTO "Account" ("id", "accountId", "providerId", "userId", "updatedAt") VALUES ('unexpected', 'pending_1', 'credential', 'pending_1', NOW())`,
    ],
    [
      "Session",
      `INSERT INTO "Session" ("id", "token", "userId", "expiresAt", "updatedAt") VALUES ('unexpected', 'token', 'pending_1', NOW(), NOW())`,
    ],
    [
      "Submission",
      `INSERT INTO "Submission" ("id", "userId", "problemId", "language", "status", "updatedAt") VALUES ('unexpected', 'pending_1', 'problem', 'cpp', 'pending_upload', NOW())`,
    ],
    [
      "future username FK",
      `CREATE TABLE "UnexpectedRosterRef" ("username" TEXT REFERENCES "User"("username") ON DELETE CASCADE); INSERT INTO "UnexpectedRosterRef" VALUES ('roster_1')`,
    ],
    [
      "audit actor",
      `UPDATE "ScoreOverrideAuditLog" SET "changedByUserId" = 'pending_1' WHERE "id" = 'deleted_score_audit'`,
    ],
  ])("refuses unexpected %s references without changing data", async (_name, sql) => {
    await execute(sql);
    const before = await snapshot();
    await expect(applyMigration(contract)).rejects.toThrow(/unexpected pending User reference/);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    [
      "real email",
      `UPDATE "User" SET "email" = 'real-person@test.local' WHERE "id" = 'pending_1'`,
      /invalid placeholder identity/,
    ],
    [
      "active synthetic account",
      `UPDATE "User" SET "status" = 'active' WHERE "id" = 'pending_1'`,
      /invalid placeholder identity/,
    ],
    [
      "verified placeholder",
      `UPDATE "User" SET "emailVerified" = true WHERE "id" = 'pending_1'`,
      /invalid placeholder identity/,
    ],
    [
      "disabled placeholder",
      `UPDATE "User" SET "disabled" = true WHERE "id" = 'pending_1'`,
      /invalid placeholder identity/,
    ],
    [
      "unnormalized username",
      `UPDATE "User" SET "username" = ' Roster_1 ' WHERE "id" = 'pending_1'`,
      /invalid placeholder identity/,
    ],
    [
      "contest score",
      `UPDATE "ScoreOverride" SET "userId" = 'pending_1' WHERE "id" = 'score_contest'`,
      /pending User has contest scores/,
    ],
    [
      "missing live membership",
      `DELETE FROM "CourseMembership" WHERE "id" = 'membership_1'`,
      /unmappable live grading subject/,
    ],
    [
      "deleted live context",
      `UPDATE "ScoreOverride" SET "contextId" = 'deleted_assignment' WHERE "id" = 'score_assignment'`,
      /unmappable live grading subject/,
    ],
  ])("refuses %s and rolls back the complete contract", async (_name, sql, error) => {
    await execute(sql);
    const before = await snapshot();
    await expect(applyMigration(contract)).rejects.toThrow(error);
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back subject backfills and placeholder detachment on a late deletion failure", async () => {
    await execute(`
      CREATE FUNCTION abort_roster_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected delete failure'; END; $$;
      CREATE TRIGGER abort_roster_delete AFTER DELETE ON "User"
      FOR EACH ROW EXECUTE FUNCTION abort_roster_delete();
    `);
    const before = await snapshot();
    await expect(applyMigration(contract)).rejects.toThrow(/injected delete failure/);
    expect(await snapshot()).toEqual(before);
    await execute('DROP TRIGGER abort_roster_delete ON "User"');
    await expect(applyMigration(contract)).resolves.toBeUndefined();
  });

  it("enforces identity, subject uniqueness, normalization, and restricted user deletion", async () => {
    await applyMigration(contract);
    for (const pendingUsername of ["", "Roster_1", " roster_1", "roster_1 ", "roster\t1"]) {
      await expect(
        inSchema(
          (tx) => tx.$executeRaw`
        UPDATE "CourseMembership" SET "pendingUsername" = ${pendingUsername} WHERE "id" = 'membership_1'
      `,
        ),
      ).rejects.toThrow(/CourseMembership_pending_username_chk/);
    }
    for (const sql of [
      `UPDATE "CourseMembership" SET "userId" = 'real' WHERE "id" = 'membership_1'`,
      `UPDATE "CourseMembership" SET "pendingUsername" = NULL WHERE "id" = 'membership_1'`,
      `UPDATE "CourseMembership" SET "pendingUsername" = 'roster_1' WHERE "id" = 'membership_2'`,
      `INSERT INTO "CourseMembership" ("id", "courseId", "userId", "role", "updatedAt") VALUES ('duplicate', 'course_1', 'real', 'student', NOW())`,
      `DELETE FROM "User" WHERE "id" = 'real'`,
      `UPDATE "ScoreOverride" SET "userId" = 'real' WHERE "id" = 'score_assignment'`,
      `UPDATE "ScoreOverride" SET "userId" = NULL WHERE "id" = 'score_contest'`,
      `UPDATE "ScoreOverride" SET "courseMembershipId" = 'membership_1' WHERE "id" = 'score_contest'`,
      `UPDATE "ScoreOverride" SET "courseMembershipId" = 'membership_1' WHERE "id" = 'score_removed'`,
      `UPDATE "SubmissionFeedback" SET "courseMembershipId" = 'membership_1' WHERE "id" = 'feedback_removed'`,
      `UPDATE "SubmissionFeedback" SET "courseMembershipId" = 'missing' WHERE "id" = 'feedback_exam'`,
    ])
      await expect(execute(sql)).rejects.toThrow();
    await execute(`
      INSERT INTO "ScoreOverrideAuditLog" ("id", "courseMembershipId", "sourceMembershipId", "problemId", "contextType", "contextId", "action")
      VALUES ('merge', 'historical_target', 'historical_source', 'problem', 'assignment', 'assignment', 'merge');
      INSERT INTO "SubmissionFeedbackAuditLog" ("id", "courseMembershipId", "sourceMembershipId", "problemId", "assessmentId", "action")
      VALUES ('merge', 'historical_target', 'historical_source', 'problem', 'assignment', 'merge');
    `);
  });
});
