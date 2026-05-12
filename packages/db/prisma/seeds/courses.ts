import type { PrismaClient } from "../../generated/prisma/client";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export async function seedCourses(
  prisma: PrismaClient,
  users: { teacher: { id: string }; taStudent: { id: string }; student: { id: string } },
) {
  const { teacher, taStudent, student } = users;
  const now = Date.now();

  // Real OAuth-registered user (student handle `41047025s`) — enroll into the OS Lab course
  // if present. Skipped on a fresh DB without the real login.
  const studentNtnu = await prisma.user.findUnique({ where: { username: "41047025s" } });

  const osLabCourse = await prisma.course.upsert({
    create: {
      description:
        "A course-managed OJ space for systems programming. Teachers own the course, TAs manage operations, and students are bulk-added by teacher-paste handles.",
      id: "course_os-lab-spring-2026",
      ownerId: teacher.id,
      title: "Operating Systems Lab",
      academicYear: 114,
      semester: 2,
    },
    update: { academicYear: 114, semester: 2 },
    where: { id: "course_os-lab-spring-2026" },
  });

  // Course memberships. Everyone is added by the teacher now that the
  // join-token flow has been removed.
  const osLabMemberships: Array<{ userId: string; role: "teacher" | "ta" | "student" }> = [
    { userId: teacher.id, role: "teacher" },
    { userId: taStudent.id, role: "ta" },
    { userId: student.id, role: "student" },
  ];
  if (studentNtnu) {
    osLabMemberships.push({ userId: studentNtnu.id, role: "student" });
  } else {
    console.log(`  Skipped enrolling 41047025s — user not present in DB`);
  }

  for (const mem of osLabMemberships) {
    await prisma.courseMembership.upsert({
      create: {
        addedByUserId: mem.role === "teacher" ? mem.userId : teacher.id,
        courseId: osLabCourse.id,
        joinedAt: new Date(),
        role: mem.role,
        status: "active",
        userId: mem.userId,
      },
      update: {},
      where: {
        courseId_userId: {
          courseId: osLabCourse.id,
          userId: mem.userId,
        },
      },
    });
  }

  const hw1 = await prisma.courseAssessment.upsert({
    create: {
      allowedLanguages: ["c", "cpp", "python"],
      closesAt: new Date("2026-03-25T15:00:00.000Z"),
      id: "hw1-process-trace",
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      dueAt: new Date("2026-03-23T15:00:00.000Z"),
      opensAt: new Date("2026-03-17T09:00:00.000Z"),
      status: "published",
      summary:
        "Coursework-oriented assignment with a visible deadline and a private systems problem.",
      title: "Homework 1: Process Trace",
      // Demo flat late penalty: submissions after `dueAt` take a 20% hit.
      adjustmentRules: [
        {
          type: "flat_late_penalty",
          penaltyPct: 20,
          startFrom: "due",
        },
      ],
    },
    update: {},
    where: { id: "hw1-process-trace" },
  });

  const hw2 = await prisma.courseAssessment.upsert({
    create: {
      id: "hw2-signal-handling",
      allowedLanguages: ["c", "cpp"],
      closesAt: new Date("2026-04-30T15:00:00.000Z"),
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      dueAt: new Date("2026-04-28T15:00:00.000Z"),
      opensAt: new Date("2026-04-16T09:00:00.000Z"),
      status: "published",
      summary:
        "Second homework exercising the per-day attempt limit — three submissions per UTC day.",
      title: "Homework 2: Signal Handling",
      // Task 1.7: per-UTC-day attempt cap. Counter resets at midnight.
      maxAttemptsPerDay: 3,
    },
    update: {},
    where: { id: "hw2-signal-handling" },
  });

  await prisma.courseAssessment.upsert({
    create: {
      id: "hw3-scheduler-draft",
      allowedLanguages: [],
      closesAt: new Date("2026-05-30T15:00:00.000Z"),
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      opensAt: new Date("2026-05-20T09:00:00.000Z"),
      status: "draft",
      summary: "Placeholder homework for TA collaboration — no problems linked yet.",
      title: "Homework 3: Scheduler (draft)",
    },
    update: {},
    where: { id: "hw3-scheduler-draft" },
  });

  const midterm = await prisma.exam.upsert({
    create: {
      allowedLanguages: ["c", "cpp"],
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      startsAt: new Date("2026-04-18T09:00:00.000Z"),
      endsAt: new Date("2026-04-18T11:00:00.000Z"),
      id: "exam_midterm-systems-lab",
      pageLockEnabled: true,
      ipWhitelistEnabled: true,
      ipWhitelist: ["140.112.0.0/16"],
      ipBindingEnabled: true,
      ipViolationMode: "block",
      scoreboardMode: "hidden",
      status: "published",
      summary:
        "Upcoming proctored midterm: page lock, IP whitelist + binding, hidden scoreboard, restricted languages.",
      title: "Midterm Systems Lab",
    },
    update: {},
    where: { id: "exam_midterm-systems-lab" },
  });

  // Assessment problem links. hw1 and hw2 get problems; hw3 is draft
  // and stays empty to mirror the TA-collab state.
  const assessmentProblemLinks = [
    { assessmentId: hw1.id, problemId: "problem_warmup-sum", ordinal: 1 },
    { assessmentId: hw1.id, problemId: "problem_process-log-parser", ordinal: 2 },
    { assessmentId: hw2.id, problemId: "problem_add-two-numbers", ordinal: 1 },
  ];

  for (const link of assessmentProblemLinks) {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { id: link.problemId },
    });

    await prisma.courseAssessmentProblem.upsert({
      create: {
        assessmentId: link.assessmentId,
        ordinal: link.ordinal,
        points: 100,
        problemId: problem.id,
      },
      update: {
        ordinal: link.ordinal,
      },
      where: {
        assessmentId_problemId: {
          assessmentId: link.assessmentId,
          problemId: problem.id,
        },
      },
    });
  }

  // Midterm exam problem links — 3 problems per course redesign task 1.8.
  const midtermProblemLinks = [
    { examId: midterm.id, problemId: "problem_graph-docking", ordinal: 1, points: 100 },
    { examId: midterm.id, problemId: "problem_fork-bomb-safeguard", ordinal: 2, points: 100 },
    { examId: midterm.id, problemId: "problem_memory-leak-forensics", ordinal: 3, points: 100 },
  ];

  for (const link of midtermProblemLinks) {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { id: link.problemId },
    });

    await prisma.examProblem.upsert({
      create: {
        examId: link.examId,
        ordinal: link.ordinal,
        points: link.points,
        problemId: problem.id,
      },
      update: {
        ordinal: link.ordinal,
        points: link.points,
      },
      where: {
        examId_problemId: {
          examId: link.examId,
          problemId: problem.id,
        },
      },
    });
  }

  // Demo fixture for 41047025s — assignment currently "in progress":
  // opens past, due in a week, with the warmup-sum problem linked. Dates are
  // recomputed every seed run so the state stays current.
  const hwActive = await prisma.courseAssessment.upsert({
    create: {
      id: "hw-demo-active",
      allowedLanguages: ["c", "cpp", "python"],
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      opensAt: new Date(now - 14 * DAY),
      dueAt: new Date(now + 7 * DAY),
      closesAt: new Date(now + 10 * DAY),
      status: "published",
      summary: "進行中作業 — 滑動視窗與雙指針練習。",
      title: "Demo: Sliding Window 進階",
    },
    update: {
      opensAt: new Date(now - 14 * DAY),
      dueAt: new Date(now + 7 * DAY),
      closesAt: new Date(now + 10 * DAY),
      status: "published",
    },
    where: { id: "hw-demo-active" },
  });

  await prisma.courseAssessmentProblem.upsert({
    create: {
      assessmentId: hwActive.id,
      ordinal: 1,
      points: 100,
      problemId: "problem_warmup-sum",
    },
    update: { ordinal: 1, points: 100 },
    where: {
      assessmentId_problemId: {
        assessmentId: hwActive.id,
        problemId: "problem_warmup-sum",
      },
    },
  });

  // Demo fixture — upcoming exam so the redesigned pre-exam "rules" view has
  // something to render. startsAt 7d out.
  const examUpcomingDemo = await prisma.exam.upsert({
    create: {
      id: "exam_demo_upcoming",
      allowedLanguages: ["c", "cpp", "python"],
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      startsAt: new Date(now + 7 * DAY),
      endsAt: new Date(now + 7 * DAY + 2 * HOUR),
      pageLockEnabled: true,
      ipBindingEnabled: false,
      ipWhitelistEnabled: false,
      scoreboardMode: "hidden",
      status: "published",
      summary: "示範用即將舉行的考試 — 開考前展示應考規則畫面。",
      title: "Demo: Final Prep Exam",
    },
    update: {
      startsAt: new Date(now + 7 * DAY),
      endsAt: new Date(now + 7 * DAY + 2 * HOUR),
      status: "published",
    },
    where: { id: "exam_demo_upcoming" },
  });

  await prisma.examProblem.upsert({
    create: {
      examId: examUpcomingDemo.id,
      ordinal: 1,
      points: 100,
      problemId: "problem_warmup-sum",
    },
    update: { ordinal: 1, points: 100 },
    where: {
      examId_problemId: {
        examId: examUpcomingDemo.id,
        problemId: "problem_warmup-sum",
      },
    },
  });

  // startsAt is far in the future so the hiding logic always fires regardless of clock.
  const upcomingDemo = await prisma.exam.upsert({
    create: {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      endsAt: new Date("2099-12-31T12:00:00.000Z"),
      id: "exam_upcoming-demo",
      scoreboardMode: "hidden",
      startsAt: new Date("2099-12-31T09:00:00.000Z"),
      status: "published",
      summary: "Upcoming exam fixture used by e2e tests for problem hiding.",
      title: "Upcoming Demo Exam",
    },
    update: {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      endsAt: new Date("2099-12-31T12:00:00.000Z"),
      startsAt: new Date("2099-12-31T09:00:00.000Z"),
      status: "published",
    },
    where: { id: "exam_upcoming-demo" },
  });

  await prisma.examProblem.upsert({
    create: {
      examId: upcomingDemo.id,
      ordinal: 1,
      points: 100,
      problemId: "problem_warmup-sum",
    },
    update: {
      ordinal: 1,
      points: 100,
    },
    where: {
      examId_problemId: {
        examId: upcomingDemo.id,
        problemId: "problem_warmup-sum",
      },
    },
  });

  console.log(`  Courses: 1 upserted with memberships and problem-linked assessments`);
}
