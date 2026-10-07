import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { examDomain, ForbiddenError, NotFoundError, problemDomain } from "@nojv/application";
import {
  createStorageClient,
  putImmutableText,
  storagePointerFor,
  StorageIntegrityError,
} from "@nojv/storage";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const checkerSource = "accept()\n";
const interactorSource = "#include <cstdio>\nint main() { return 42; }\n";
const minutes = (count: number) => new Date(Date.now() + count * 60_000);

function actorOf(user: Awaited<ReturnType<typeof createTestUser>>) {
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole,
  };
}

async function buildStudent() {
  return actorOf(await createTestUser({ platformRole: "student" }));
}

async function checkerProblem(visibility: "public" | "private" = "public") {
  const checkerStorage = await putImmutableText(
    createStorageClient(),
    `problems/checker-${Math.random()}/checker.py`,
    checkerSource,
  );
  return createTestProblem({
    visibility,
    judgeConfig: { type: "checker", checkerLanguage: "python" },
    checkerStorage,
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const checkerView = {
  role: "checker",
  language: "python",
  source: checkerSource,
  sha256: sha256(checkerSource),
};

function source(
  actor: ReturnType<typeof actorOf>,
  problemId: string,
  context: Parameters<typeof problemDomain.getJudgeProgramSource>[2] = { type: "practice" },
) {
  return problemDomain.getJudgeProgramSource(actor, problemId, context, "127.0.0.1");
}

async function enrol(courseId: string, userId: string) {
  await testPrisma.courseMembership.create({
    data: { courseId, userId, role: "student", status: "active", joinedAt: new Date() },
  });
}

async function examWithProblem(
  problemId: string,
  options: { startsAt?: Date; endsAt?: Date; pageLockEnabled?: boolean } = {},
) {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const course = await createTestCourse({ ownerId: teacher.id });
  const exam = await createTestExam({
    courseId: course.id,
    status: "published",
    startsAt: options.startsAt ?? minutes(-1),
    endsAt: options.endsAt ?? minutes(60),
    pageLockEnabled: options.pageLockEnabled ?? false,
  });
  await testPrisma.examProblem.create({
    data: { examId: exam.id, problemId, ordinal: 1, points: 100 },
  });
  return { course, exam };
}

async function contestWithProblem(problemId: string, startsAt: Date, endsAt: Date) {
  const organizer = await createTestUser({ platformRole: "teacher" });
  const contest = await createTestContest({ createdByUserId: organizer.id, startsAt, endsAt });
  await testPrisma.contestProblem.create({
    data: { contestId: contest.id, problemId, ordinal: 1, points: 100 },
  });
  return contest;
}

describe("problemDomain.getJudgeProgramSource", () => {
  it("returns a practice checker's role, language, source and digest", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem();

    await expect(source(student, problem.id)).resolves.toEqual(checkerView);
  });

  it("returns an interactive problem's interactor", async () => {
    const student = await buildStudent();
    const interactorStorage = await putImmutableText(
      createStorageClient(),
      "problems/interactor-fixture/interactor.cpp",
      interactorSource,
    );
    const problem = await createTestProblem({
      judgeConfig: { type: "interactive", interactorLanguage: "cpp" },
      interactorStorage,
    });

    await expect(source(student, problem.id)).resolves.toEqual({
      role: "interactor",
      language: "cpp",
      source: interactorSource,
      sha256: sha256(interactorSource),
    });
  });

  it("hides a private practice problem the student cannot view", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem("private");

    await expect(source(student, problem.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([
    ["standard", { judgeConfig: { type: "standard" } }],
    ["special_env", { type: "special_env", judgeConfig: { type: "checker" } }],
  ] as const)("answers 404 for a %s problem", async (_label, overrides) => {
    const student = await buildStudent();
    const problem = await createTestProblem(overrides);

    await expect(source(student, problem.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("answers 404 for a checker problem without a stored checker", async () => {
    const student = await buildStudent();
    const problem = await createTestProblem({
      judgeConfig: { type: "checker", checkerLanguage: "cpp" },
    });

    await expect(source(student, problem.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a checker whose stored bytes do not match its pointer", async () => {
    const student = await buildStudent();
    await putImmutableText(createStorageClient(), "k", checkerSource);
    const problem = await createTestProblem({
      judgeConfig: { type: "checker", checkerLanguage: "python" },
      checkerStorage: storagePointerFor("k", Buffer.from("x")),
    });

    await expect(source(student, problem.id)).rejects.toBeInstanceOf(StorageIntegrityError);
  });

  it("lets an enrolled student read an open assignment's private checker", async () => {
    const student = await buildStudent();
    const outsider = await buildStudent();
    const problem = await checkerProblem("private");
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "HW",
        summary: "Open",
        status: "published",
        opensAt: minutes(-60),
        closesAt: minutes(60),
      },
    });
    await testPrisma.assessmentProblem.create({
      data: { assessmentId: assessment.id, problemId: problem.id, ordinal: 1, points: 100 },
    });
    await enrol(course.id, student.userId);
    const context = {
      type: "assignment" as const,
      courseId: course.id,
      assessmentId: assessment.id,
    };

    await expect(source(student, problem.id, context)).resolves.toEqual(checkerView);
    await expect(source(outsider, problem.id, context)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a student in a running exam session read the exam's private checker", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem("private");
    const { course, exam } = await examWithProblem(problem.id);
    await enrol(course.id, student.userId);
    const context = { type: "exam" as const, examId: exam.id };

    await expect(source(student, problem.id, context)).rejects.toBeInstanceOf(NotFoundError);
    await examDomain.session.startSessionWithGate(student, { examId: exam.id });
    await expect(source(student, problem.id, context)).resolves.toEqual(checkerView);
  });

  it("lets the exam's course staff preview its checker without a session", async () => {
    const problem = await checkerProblem("private");
    const { course, exam } = await examWithProblem(problem.id, {
      startsAt: minutes(60),
      endsAt: minutes(120),
    });
    const staff = await createTestUser({ platformRole: "teacher" });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: staff.id, role: "ta", status: "active" },
    });

    await expect(
      source(actorOf(staff), problem.id, { type: "exam", examId: exam.id }),
    ).resolves.toEqual(checkerView);
  });

  it("keeps a page-locked exam session inside its own exam", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem();
    const other = await checkerProblem();
    const { course, exam } = await examWithProblem(problem.id, { pageLockEnabled: true });
    await enrol(course.id, student.userId);
    await examDomain.session.startSessionWithGate(student, { examId: exam.id });
    const context = { type: "exam" as const, examId: exam.id };

    await expect(source(student, problem.id, context)).resolves.toEqual(checkerView);
    await expect(source(student, problem.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(source(student, other.id, context)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps serving an ended exam's private checker to its participant", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem("private");
    const { course, exam } = await examWithProblem(problem.id, {
      startsAt: minutes(-120),
      endsAt: minutes(-1),
    });
    await enrol(course.id, student.userId);
    await testPrisma.participation.create({
      data: { type: "exam", examId: exam.id, userId: student.userId, status: "submitted" },
    });

    await expect(source(student, problem.id)).resolves.toEqual(checkerView);
    await expect(
      source(student, problem.id, { type: "exam", examId: exam.id }),
    ).resolves.toEqual(checkerView);
  });

  it("serves a contest's private checker to participants while it runs and after it ends", async () => {
    const student = await buildStudent();
    const outsider = await buildStudent();
    const running = await checkerProblem("private");
    const ended = await checkerProblem("private");
    const live = await contestWithProblem(running.id, minutes(-1), minutes(60));
    const past = await contestWithProblem(ended.id, minutes(-120), minutes(-1));
    for (const contest of [live, past]) {
      await testPrisma.participation.create({
        data: {
          type: "contest",
          contestId: contest.id,
          userId: student.userId,
          status: "active",
        },
      });
    }

    await expect(
      source(student, running.id, { type: "contest", contestId: live.id }),
    ).resolves.toEqual(checkerView);
    await expect(
      source(student, ended.id, { type: "contest", contestId: past.id }),
    ).resolves.toEqual(checkerView);
    await expect(source(student, ended.id)).resolves.toEqual(checkerView);
    await expect(
      source(outsider, running.id, { type: "contest", contestId: live.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("serves a virtual contest's private checker only to its owner while the timer runs", async () => {
    const student = await buildStudent();
    const outsider = await buildStudent();
    const problem = await checkerProblem("private");
    const contest = await contestWithProblem(problem.id, minutes(-180), minutes(-120));
    const virtual = await testPrisma.participation.create({
      data: {
        type: "virtual",
        contestId: contest.id,
        userId: student.userId,
        status: "active",
        startedAt: minutes(-10),
        endsAt: minutes(50),
      },
    });
    const context = { type: "virtual" as const, participationId: virtual.id };

    await expect(source(student, problem.id, context)).resolves.toEqual(checkerView);
    await expect(source(outsider, problem.id, context)).rejects.toBeInstanceOf(NotFoundError);
  });
});
