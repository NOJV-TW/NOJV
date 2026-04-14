import type { PrismaClient } from "../../generated/prisma/client";

export async function seedCourses(
  prisma: PrismaClient,
  users: { teacher: { id: string }; taStudent: { id: string }; student: { id: string } }
) {
  const { teacher, taStudent, student } = users;

  const osLabCourse = await prisma.course.upsert({
    create: {
      description:
        "A course-managed OJ space for systems programming. Teachers own the course, TAs manage operations, and students are bulk-added by teacher-paste handles.",
      id: "course_os-lab-spring-2026",
      ownerId: teacher.id,
      title: "Operating Systems Lab"
    },
    update: {},
    where: { id: "course_os-lab-spring-2026" }
  });

  // Course memberships. Everyone is added by the teacher now that the
  // join-token flow has been removed.
  const osLabMemberships = [
    { userId: teacher.id, role: "teacher" as const },
    { userId: taStudent.id, role: "ta" as const },
    { userId: student.id, role: "student" as const }
  ];

  for (const mem of osLabMemberships) {
    await prisma.courseMembership.upsert({
      create: {
        addedByUserId: mem.role === "teacher" ? mem.userId : teacher.id,
        courseId: osLabCourse.id,
        joinedAt: new Date(),
        role: mem.role,
        status: "active",
        userId: mem.userId
      },
      update: {},
      where: {
        courseId_userId: {
          courseId: osLabCourse.id,
          userId: mem.userId
        }
      }
    });
  }

  // Course assessments. Homework no longer has IP lock, page lock, or
  // a scoreboard — those are exam concerns and live on Contest now.
  const hw1 = await prisma.courseAssessment.upsert({
    create: {
      allowedLanguages: ["c", "cpp", "python"],
      closesAt: new Date("2026-03-25T15:00:00.000Z"),
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      dueAt: new Date("2026-03-23T15:00:00.000Z"),
      opensAt: new Date("2026-03-17T09:00:00.000Z"),
      slug: "hw1-process-trace",
      status: "published",
      summary:
        "Coursework-oriented assignment with a visible deadline and a private systems problem.",
      title: "Homework 1: Process Trace",
      // Demo flat late penalty: submissions after `dueAt` take a 20% hit.
      adjustmentRules: [
        {
          type: "flat_late_penalty",
          penaltyPct: 20,
          startFrom: "due"
        }
      ]
    },
    update: {},
    where: {
      courseId_slug: {
        courseId: osLabCourse.id,
        slug: "hw1-process-trace"
      }
    }
  });

  // Midterm is now a course-linked Contest (exams are contests)
  const midterm = await prisma.contest.upsert({
    create: {
      allowedLanguages: ["c", "cpp"],
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      endsAt: new Date("2026-04-02T12:00:00.000Z"),
      frozenBoard: false,
      id: "contest_midterm-systems-lab",
      ipWhitelistEnabled: true,
      ipWhitelist: ["140.112.0.0/16"],
      pageLockEnabled: true,
      scoreboardMode: "live",
      slug: "midterm-systems-lab",
      startsAt: new Date("2026-04-02T09:00:00.000Z"),
      summary:
        "Exam-style contest with page lock, IP lock, live ranking, and restricted languages.",
      title: "Midterm Systems Lab",
      visibility: "published"
    },
    update: {},
    where: { slug: "midterm-systems-lab" }
  });

  // Assessment problem links (hw1 only — midterm is now a contest)
  const assessmentProblemLinks = [
    { assessmentId: hw1.id, problemId: "problem_warmup-sum", ordinal: 1 },
    { assessmentId: hw1.id, problemId: "problem_process-log-parser", ordinal: 2 }
  ];

  for (const link of assessmentProblemLinks) {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { id: link.problemId }
    });

    await prisma.courseAssessmentProblem.upsert({
      create: {
        assessmentId: link.assessmentId,
        ordinal: link.ordinal,
        points: 100,
        problemId: problem.id
      },
      update: {
        ordinal: link.ordinal
      },
      where: {
        assessmentId_problemId: {
          assessmentId: link.assessmentId,
          problemId: problem.id
        }
      }
    });
  }

  // Midterm contest problem links
  const midtermProblemLinks = [
    { contestId: midterm.id, problemId: "problem_graph-docking", ordinal: 1, points: 100 },
    { contestId: midterm.id, problemId: "problem_fork-bomb-safeguard", ordinal: 2, points: 100 }
  ];

  for (const link of midtermProblemLinks) {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { id: link.problemId }
    });

    await prisma.contestProblem.upsert({
      create: {
        contestId: link.contestId,
        ordinal: link.ordinal,
        points: link.points,
        problemId: problem.id
      },
      update: {
        ordinal: link.ordinal,
        points: link.points
      },
      where: {
        contestId_problemId: {
          contestId: link.contestId,
          problemId: problem.id
        }
      }
    });
  }

  // Upcoming demo contest — linked to the OS lab course. Used by the
  // contest-hidden-problems e2e tests to verify that students see the
  // placeholder and course teachers see the seeded problem title.
  // startsAt is set far into the future so the hiding logic always fires
  // during e2e runs regardless of clock drift.
  const upcomingDemo = await prisma.contest.upsert({
    create: {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      endsAt: new Date("2099-12-31T12:00:00.000Z"),
      frozenBoard: false,
      id: "contest_upcoming-demo-contest",
      scoreboardMode: "live",
      slug: "upcoming-demo-contest",
      startsAt: new Date("2099-12-31T09:00:00.000Z"),
      summary: "Upcoming contest fixture used by e2e tests for problem hiding.",
      title: "Upcoming Demo Contest",
      visibility: "published"
    },
    update: {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      endsAt: new Date("2099-12-31T12:00:00.000Z"),
      startsAt: new Date("2099-12-31T09:00:00.000Z"),
      visibility: "published"
    },
    where: { slug: "upcoming-demo-contest" }
  });

  await prisma.contestProblem.upsert({
    create: {
      contestId: upcomingDemo.id,
      ordinal: 1,
      points: 100,
      problemId: "problem_warmup-sum"
    },
    update: {
      ordinal: 1,
      points: 100
    },
    where: {
      contestId_problemId: {
        contestId: upcomingDemo.id,
        problemId: "problem_warmup-sum"
      }
    }
  });

  console.log(`  Courses: 1 upserted with memberships and problem-linked assessments`);
}
