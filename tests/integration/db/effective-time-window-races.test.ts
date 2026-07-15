import { describe, expect, it } from "vitest";

import {
  assignmentDomain,
  contestDomain,
  examDomain,
  ValidationError,
} from "@nojv/application";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

type WindowTable = "Assessment" | "Contest" | "Exam";
type StartColumn = "opensAt" | "startsAt";

const INITIAL_START = new Date("2030-01-01T00:00:00.000Z");
const PATCHED_END = new Date("2030-01-05T00:00:00.000Z");
const CONCURRENT_START = new Date("2030-01-08T00:00:00.000Z");
const INITIAL_DUE = new Date("2030-01-09T00:00:00.000Z");
const INITIAL_END = new Date("2030-01-10T00:00:00.000Z");

function actorOf(user: {
  id: string;
  username: string | null;
  name: string;
  email: string;
  platformRole: "admin" | "student" | "teacher";
}) {
  if (!user.username) throw new Error("Race-test actor requires a username.");
  return {
    userId: user.id,
    username: user.username,
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole,
  };
}

function holdStartUpdate(
  table: WindowTable,
  startColumn: StartColumn,
  id: string,
): {
  completed: Promise<void>;
  ready: Promise<number>;
  release: () => void;
} {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let readyResolve!: (backendPid: number) => void;
  let readyReject!: (error: unknown) => void;
  const ready = new Promise<number>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const completed = testPrisma
    .$transaction(
      async (transaction) => {
        const backend = (
          await transaction.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid")
        ).at(0);
        if (!backend) throw new Error("Missing PostgreSQL backend pid.");
        await transaction.$queryRawUnsafe(
          `SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`,
          id,
        );
        await transaction.$executeRawUnsafe(
          `UPDATE "${table}" SET "${startColumn}" = $1 WHERE id = $2`,
          CONCURRENT_START,
          id,
        );
        readyResolve(backend.pid);
        await released;
      },
      { timeout: 10_000 },
    )
    .catch((error: unknown) => {
      readyReject(error);
      throw error;
    });

  return { completed, ready, release };
}

async function waitUntilBlockedBy(lockerPid: number, table: WindowTable): Promise<void> {
  const deadline = Date.now() + 3_000;
  const queryPattern = `%FROM "${table}"%FOR UPDATE%`;

  while (Date.now() < deadline) {
    const blockers = await testPrisma.$queryRawUnsafe<{ pid: number }[]>(
      `
        SELECT pid
        FROM pg_stat_activity
        WHERE $1::integer = ANY(pg_blocking_pids(pid))
          AND query LIKE $2
      `,
      lockerPid,
      queryPattern,
    );
    if (blockers.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for ${table} domain update to block on FOR UPDATE.`);
}

async function expectSerializedRejection(input: {
  table: WindowTable;
  startColumn: StartColumn;
  id: string;
  update: () => Promise<unknown>;
  read: () => Promise<{ start: Date; end: Date }>;
}): Promise<void> {
  const held = holdStartUpdate(input.table, input.startColumn, input.id);
  let lockerPid: number;
  try {
    lockerPid = await held.ready;
  } catch {
    held.release();
    await held.completed;
    throw new Error("Lock holder completed without becoming ready.");
  }
  const updateResult = input.update().then(
    () => ({ error: null }),
    (error: unknown) => ({ error }),
  );

  let blockingError: unknown;
  try {
    await waitUntilBlockedBy(lockerPid, input.table);
  } catch (error) {
    blockingError = error;
  } finally {
    held.release();
    await held.completed;
  }

  const { error } = await updateResult;
  if (blockingError) {
    throw blockingError instanceof Error
      ? blockingError
      : new Error("Failed while checking PostgreSQL blocking state.", { cause: blockingError });
  }
  expect(error).toBeInstanceOf(ValidationError);
  expect(await input.read()).toEqual({ start: CONCURRENT_START, end: INITIAL_END });
}

describe("effective time-window row-lock barriers", () => {
  it("serializes an Exam end patch behind a concurrent start update", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const exam = await createTestExam({
      courseId: course.id,
      createdByUserId: teacher.id,
      status: "draft",
      startsAt: INITIAL_START,
      endsAt: INITIAL_END,
    });

    await expectSerializedRejection({
      table: "Exam",
      startColumn: "startsAt",
      id: exam.id,
      update: () =>
        examDomain.updateExamRecord(actorOf(teacher), exam.id, {
          endsAt: PATCHED_END.toISOString(),
        }),
      read: async () => {
        const row = await testPrisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
        return { start: row.startsAt, end: row.endsAt };
      },
    });
  });

  it("serializes a Contest end patch behind a concurrent start update", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const contest = await createTestContest({
      createdByUserId: teacher.id,
      visibility: "draft",
      startsAt: INITIAL_START,
      endsAt: INITIAL_END,
    });

    await expectSerializedRejection({
      table: "Contest",
      startColumn: "startsAt",
      id: contest.id,
      update: () =>
        contestDomain.updateContestRecord(actorOf(teacher), contest.id, {
          endsAt: PATCHED_END.toISOString(),
        }),
      read: async () => {
        const row = await testPrisma.contest.findUniqueOrThrow({ where: { id: contest.id } });
        return { start: row.startsAt, end: row.endsAt };
      },
    });
  });

  it("serializes an Assessment close patch behind a concurrent open update", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "Race-safe assignment",
        summary: "Effective window race test",
        status: "draft",
        opensAt: INITIAL_START,
        dueAt: INITIAL_DUE,
        closesAt: INITIAL_END,
      },
    });

    await expectSerializedRejection({
      table: "Assessment",
      startColumn: "opensAt",
      id: assessment.id,
      update: () =>
        assignmentDomain.updateAssignmentRecord(actorOf(teacher), assessment.id, {
          closesAt: PATCHED_END.toISOString(),
        }),
      read: async () => {
        const row = await testPrisma.assessment.findUniqueOrThrow({
          where: { id: assessment.id },
        });
        return { start: row.opensAt, end: row.closesAt };
      },
    });
  });
});
