import type { PrismaClient } from "../../generated/prisma/client";

export async function seedCourses(
  prisma: PrismaClient,
  users: { teacher: { id: string }; taStudent: { id: string }; student: { id: string } }
) {
  const { teacher, taStudent, student } = users;

  const osLabCourse = await prisma.course.upsert({
    create: {
      description:
        "A course-managed OJ space for systems programming. Teachers own the course, TAs manage operations, and students join by QR code, join code, or manual enrollment.",
      id: "course_os-lab-spring-2026",
      locale: "zh-TW",
      ownerId: teacher.id,
      slug: "os-lab-spring-2026",
      title: "Operating Systems Lab",
      visibility: "invite_only"
    },
    update: {},
    where: { slug: "os-lab-spring-2026" }
  });

  // Course memberships
  const osLabMemberships = [
    {
      courseId: osLabCourse.id,
      userId: teacher.id,
      role: "teacher" as const,
      joinedVia: "manual_invite" as const
    },
    {
      courseId: osLabCourse.id,
      userId: taStudent.id,
      role: "ta" as const,
      joinedVia: "manual_invite" as const
    },
    {
      courseId: osLabCourse.id,
      userId: student.id,
      role: "student" as const,
      joinedVia: "join_code" as const
    }
  ];

  for (const mem of osLabMemberships) {
    await prisma.courseMembership.upsert({
      create: {
        addedByUserId: mem.role === "teacher" ? mem.userId : teacher.id,
        courseId: mem.courseId,
        joinedAt: new Date(),
        joinedVia: mem.joinedVia,
        role: mem.role,
        status: "active",
        userId: mem.userId
      },
      update: {},
      where: {
        courseId_userId: {
          courseId: mem.courseId,
          userId: mem.userId
        }
      }
    });
  }

  // Course join tokens
  const joinTokens = [
    {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      label: "Course QR",
      method: "qr_code" as const,
      token: "oslab-qr-2026"
    },
    {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      label: "Course code",
      method: "join_code" as const,
      token: "OSLAB2026"
    },
    {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      label: "Manual roster sync",
      method: "manual_invite" as const,
      token: "teacher-managed-oslab"
    }
  ];

  for (const jt of joinTokens) {
    await prisma.courseJoinToken.upsert({
      create: jt,
      update: {},
      where: { token: jt.token }
    });
  }

  // Course problems
  const osLabProblemIds = [
    "problem_warmup-sum",
    "problem_graph-docking",
    "problem_process-log-parser",
    "problem_fork-bomb-safeguard"
  ];

  for (const problemId of osLabProblemIds) {
    const problem = await prisma.problem.findUniqueOrThrow({ where: { id: problemId } });
    await prisma.courseProblem.upsert({
      create: {
        addedByUserId: teacher.id,
        courseId: osLabCourse.id,
        problemId: problem.id
      },
      update: {},
      where: {
        courseId_problemId: {
          courseId: osLabCourse.id,
          problemId: problem.id
        }
      }
    });
  }

  // Course assessments
  const hw1 = await prisma.courseAssessment.upsert({
    create: {
      allowedLanguages: ["c", "cpp", "python"],
      closesAt: new Date("2026-03-25T15:00:00.000Z"),
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      dueAt: new Date("2026-03-23T15:00:00.000Z"),
      opensAt: new Date("2026-03-17T09:00:00.000Z"),
      scoreboardMode: "hidden",
      slug: "hw1-process-trace",
      status: "published",
      summary:
        "Coursework-oriented assignment with a visible deadline and a private systems problem.",
      title: "Homework 1: Process Trace",
      // Demo late-penalty decay: score halves every 48 hours past due.
      adjustmentRules: [
        {
          type: "late_penalty_decay",
          halfLifeHours: 48
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

  console.log(`  Courses: 1 upserted with memberships, join tokens, problems, and assessments`);
}
