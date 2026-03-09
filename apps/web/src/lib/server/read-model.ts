import { prisma } from "@nojv/db";
import type {
  CourseAssessmentType,
  CourseJoinMethod,
  CourseRole,
  LocaleCode,
  PlatformRole
} from "@nojv/domain";

import { starterByLanguage, type ProblemDetail } from "../problem-types";

// --- Course-related types (previously in course-poc-data.ts) ---

export interface CoursePocMember {
  courseRole: CourseRole;
  displayName: string;
  email: string;
  handle: string;
  joinedVia: CourseJoinMethod;
  platformRole: PlatformRole;
  userId: string;
}

export interface CoursePocAssessment {
  closesAt: string;
  dueAt: string;
  opensAt: string;
  problemSlugs: string[];
  scoreboardMode: "frozen" | "hidden" | "live";
  slug: string;
  summary: string;
  title: string;
  type: CourseAssessmentType;
}

export interface CourseProblemCatalogEntry {
  authorHandle: string;
  slug: string;
  summary: string;
  title: string;
  visibility: "private" | "public";
}

export type CoursePageData = {
  assessments: CoursePocAssessment[];
  description: string;
  joinChannels: {
    label: string;
    method: CourseJoinMethod;
    token: string;
  }[];
  locale: LocaleCode;
  members: CoursePocMember[];
  problemSlugs: string[];
  slug: string;
  title: string;
};

export interface CoursePageDetailData {
  course: CoursePageData;
  problems: CourseProblemCatalogEntry[];
}

// --- Helper functions ---

function calculateAcceptanceRate(submissionStatuses: { status: string }[] | undefined) {
  if (!submissionStatuses || submissionStatuses.length === 0) {
    return 0;
  }

  const accepted = submissionStatuses.filter((submission) => submission.status === "accepted");

  return accepted.length / submissionStatuses.length;
}

function pickProblemStatement(
  statements: { bodyMarkdown: string; locale: string; title: string }[] | undefined,
  locale: string,
  fallbackTitle: string,
  fallbackStatement: string
) {
  const localized =
    statements?.find((statement) => statement.locale === locale) ?? statements?.[0] ?? null;

  return {
    statement: localized?.bodyMarkdown ?? fallbackStatement,
    title: localized?.title ?? fallbackTitle
  };
}

function mapProblemShelfEntry(problem: {
  author?: { handle: string } | null;
  slug: string;
  statements?: { bodyMarkdown: string; locale: string; title: string }[];
  summary: string;
  visibility: "private" | "public";
}) {
  const localized = pickProblemStatement(
    problem.statements,
    "zh-TW",
    problem.slug,
    problem.summary
  );

  return {
    authorHandle: problem.author?.handle ?? "course_staff",
    slug: problem.slug,
    summary: problem.summary.trim().length > 0 ? problem.summary : localized.statement,
    title: localized.title,
    visibility: problem.visibility
  } satisfies CourseProblemCatalogEntry;
}

function mapAssessmentRecord(assessment: {
  closesAt: Date;
  dueAt: Date;
  opensAt: Date;
  problems?: { ordinal: number; problem: { slug: string } }[];
  problemLinks?: { ordinal: number; problem: { slug: string } }[];
  scoreboardMode: "frozen" | "hidden" | "live";
  slug: string;
  summary: string;
  title: string;
  type: "assignment" | "exam";
}) {
  const linkedProblems = Array.isArray(assessment.problems)
    ? assessment.problems
    : Array.isArray(assessment.problemLinks)
      ? assessment.problemLinks
      : [];

  return {
    closesAt: assessment.closesAt.toISOString(),
    dueAt: assessment.dueAt.toISOString(),
    opensAt: assessment.opensAt.toISOString(),
    problemSlugs: [...linkedProblems]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((link) => link.problem.slug),
    scoreboardMode: assessment.scoreboardMode,
    slug: assessment.slug,
    summary: assessment.summary,
    title: assessment.title,
    type: assessment.type
  } satisfies CoursePocAssessment;
}

function mapCourseMember(member: {
  joinedVia: "join_code" | "manual_invite" | "qr_code" | null;
  role: "student" | "ta" | "teacher";
  user: {
    name: string;
    email: string;
    handle: string;
    platformRole: "admin" | "student" | "teacher";
  };
  userId: string;
}) {
  return {
    courseRole: member.role,
    displayName: member.user.name,
    email: member.user.email,
    handle: member.user.handle,
    joinedVia: member.joinedVia ?? "manual_invite",
    platformRole: member.user.platformRole,
    userId: member.userId
  } satisfies CoursePocMember;
}

function mapPersistedCourse(course: {
  assessments: {
    closesAt: Date;
    dueAt: Date;
    opensAt: Date;
    problems?: { ordinal: number; problem: { slug: string } }[];
    problemLinks?: { ordinal: number; problem: { slug: string } }[];
    scoreboardMode: "frozen" | "hidden" | "live";
    slug: string;
    summary: string;
    title: string;
    type: "assignment" | "exam";
  }[];
  description: string;
  joinTokens: {
    label: string;
    method: "join_code" | "manual_invite" | "qr_code";
    token: string;
  }[];
  locale: string;
  memberships: {
    joinedVia: "join_code" | "manual_invite" | "qr_code" | null;
    role: "student" | "ta" | "teacher";
    user: {
      name: string;
      email: string;
      handle: string;
      platformRole: "admin" | "student" | "teacher";
    };
    userId: string;
  }[];
  problems: {
    problem: {
      author?: { handle: string } | null;
      slug: string;
      statements?: { bodyMarkdown: string; locale: string; title: string }[];
      summary: string;
      visibility: "private" | "public";
    };
  }[];
  slug: string;
  title: string;
}): CoursePageDetailData {
  const assessments = course.assessments.map(mapAssessmentRecord);
  const members = course.memberships.map(mapCourseMember);
  const problems = course.problems.map((entry) => mapProblemShelfEntry(entry.problem));

  return {
    course: {
      assessments,
      description: course.description,
      joinChannels: course.joinTokens.map((token) => ({
        label: token.label,
        method: token.method,
        token: token.token
      })),
      locale: course.locale as "en" | "zh-TW",
      members,
      problemSlugs: problems.map((problem) => problem.slug),
      slug: course.slug,
      title: course.title
    } satisfies CoursePageData,
    problems
  } satisfies CoursePageDetailData;
}

function buildProblemSamples(problem: {
  testcaseSets?: {
    isHidden: boolean;
    testcases: {
      expectedStdout: string | null;
      stdin: string;
    }[];
  }[];
}) {
  const visibleSet =
    problem.testcaseSets?.find((testcaseSet) => !testcaseSet.isHidden) ??
    problem.testcaseSets?.[0];
  const sample = visibleSet?.testcases[0];

  if (!sample) {
    return [];
  }

  return [
    {
      explanation: "Sample case extracted from the authored testcase set.",
      input: sample.stdin,
      output: sample.expectedStdout ?? ""
    }
  ];
}

function mapPersistedProblemDetail(
  problem: {
    author?: { handle: string } | null;
    defaultTitle: string;
    difficulty: string;
    slug: string;
    statements?: { bodyMarkdown: string; locale: string; title: string }[];
    submissions?: { status: string }[];
    summary: string;
    testcaseSets?: {
      isHidden: boolean;
      testcases: {
        expectedStdout: string | null;
        stdin: string;
      }[];
    }[];
    visibility: "private" | "public";
  },
  locale: string
) {
  const localized = pickProblemStatement(
    problem.statements,
    locale,
    problem.defaultTitle,
    problem.summary
  );

  return {
    acceptanceRate: calculateAcceptanceRate(problem.submissions),
    authorHandle: problem.author?.handle ?? "course_staff",
    difficulty: problem.difficulty as "easy" | "hard" | "medium",
    samples: buildProblemSamples(problem),
    slug: problem.slug,
    starterByLanguage,
    statement: localized.statement,
    summary: problem.summary.trim().length > 0 ? problem.summary : localized.statement,
    tags: [],
    title: localized.title,
    totalSubmissions: problem.submissions?.length ?? 0,
    visibility: problem.visibility
  } satisfies ProblemDetail;
}

// --- Public query functions ---

export async function listCourseCards() {
  const persistedCourses = await prisma.course.findMany({
    include: {
      assessments: {
        select: {
          id: true
        },
        where: {
          status: "published"
        }
      },
      memberships: {
        select: {
          id: true
        },
        where: {
          status: "active"
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return persistedCourses.map((course) => ({
    assessmentCount: course.assessments.length,
    memberCount: course.memberships.length,
    slug: course.slug,
    title: course.title
  }));
}

export async function getCoursePageData(slug: string): Promise<CoursePageDetailData | null> {
  const persistedCourse = await prisma.course.findUnique({
    include: {
      assessments: {
        include: {
          problems: {
            include: {
              problem: true
            },
            orderBy: {
              ordinal: "asc"
            }
          }
        },
        orderBy: {
          opensAt: "asc"
        }
      },
      joinTokens: {
        orderBy: {
          createdAt: "asc"
        }
      },
      memberships: {
        include: {
          user: true
        },
        orderBy: {
          createdAt: "asc"
        },
        where: {
          status: "active"
        }
      },
      problems: {
        include: {
          problem: {
            include: {
              author: {
                select: {
                  handle: true
                }
              },
              statements: true
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    },
    where: {
      slug
    }
  });

  if (!persistedCourse) {
    return null;
  }

  return mapPersistedCourse(persistedCourse);
}

export async function listProblemCards() {
  const persistedProblems = await prisma.problem.findMany({
    include: {
      _count: {
        select: { submissions: true }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    where: {
      visibility: "public"
    }
  });

  // Batch-fetch accepted counts per problem
  const problemIds = persistedProblems.map((p) => p.id);
  const acceptedCounts =
    problemIds.length > 0
      ? await prisma.submission.groupBy({
          by: ["problemId"],
          _count: true,
          where: { problemId: { in: problemIds }, status: "accepted" }
        })
      : [];
  const acceptedByProblemId = new Map(
    acceptedCounts.map((r) => [r.problemId, r._count])
  );

  return persistedProblems.map((problem) => {
    const total = problem._count.submissions;
    const accepted = acceptedByProblemId.get(problem.id) ?? 0;
    return {
      acceptanceRate: total > 0 ? accepted / total : 0,
      difficulty: problem.difficulty as "easy" | "hard" | "medium",
      slug: problem.slug,
      title: problem.defaultTitle,
      totalSubmissions: total
    };
  });
}

export async function listEditableProblems(userId: string) {
  const problems = await prisma.problem.findMany({
    orderBy: { createdAt: "desc" },
    where: {
      OR: [
        { authorId: userId },
        {
          assessmentLinks: {
            some: {
              assessment: {
                course: {
                  memberships: {
                    some: {
                      userId,
                      role: { in: ["teacher", "ta"] },
                      status: "active"
                    }
                  }
                }
              }
            }
          }
        }
      ]
    }
  });

  return problems.map((problem) => ({
    difficulty: problem.difficulty as "easy" | "hard" | "medium",
    slug: problem.slug,
    title: problem.defaultTitle,
    visibility: problem.visibility
  }));
}

export async function listContestCards() {
  const contests = await prisma.contest.findMany({
    include: {
      problems: { select: { id: true } }
    },
    orderBy: { startsAt: "desc" },
    where: { visibility: "published" }
  });

  return contests.map((contest) => ({
    endsAt: contest.endsAt.toISOString(),
    problemCount: contest.problems.length,
    slug: contest.slug,
    startsAt: contest.startsAt.toISOString(),
    summary: contest.summary,
    title: contest.title
  }));
}

export async function getContestPageData(slug: string) {
  const contest = await prisma.contest.findUnique({
    include: {
      problems: {
        include: { problem: true },
        orderBy: { ordinal: "asc" }
      }
    },
    where: { slug }
  });

  if (!contest) {
    return null;
  }

  return {
    endsAt: contest.endsAt.toISOString(),
    frozenScoreboard: contest.frozenBoard,
    problems: contest.problems.map((cp) => ({
      points: cp.points,
      slug: cp.problem.slug,
      title: cp.problem.defaultTitle
    })),
    slug: contest.slug,
    startsAt: contest.startsAt.toISOString(),
    summary: contest.summary,
    title: contest.title
  };
}

export async function listUserSubmissions(userId: string) {
  return prisma.submission.findMany({
    orderBy: {
      createdAt: "desc"
    },
    select: {
      createdAt: true,
      id: true,
      language: true,
      problem: {
        select: {
          defaultTitle: true,
          slug: true
        }
      },
      runtimeMs: true,
      score: true,
      status: true
    },
    take: 50,
    where: {
      userId
    }
  });
}

export async function getProblemPageData(slug: string, locale: string) {
  const persistedProblem = await prisma.problem.findUnique({
    include: {
      author: {
        select: {
          handle: true
        }
      },
      statements: true,
      submissions: {
        select: {
          status: true
        }
      },
      testcaseSets: {
        include: {
          testcases: {
            orderBy: {
              ordinal: "asc"
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    },
    where: {
      slug
    }
  });

  if (!persistedProblem) {
    return null;
  }

  return mapPersistedProblemDetail(persistedProblem, locale);
}

export async function listIntegrityCases() {
  const cases = await prisma.cheatingCase.findMany({
    include: {
      _count: {
        select: { signals: true }
      },
      user: {
        select: { handle: true }
      }
    },
    orderBy: { openedAt: "desc" },
    take: 20
  });

  return cases.map((c) => ({
    caseId: c.id,
    score: c.score,
    signalCount: c._count.signals,
    state: c.status,
    userId: c.user.handle
  }));
}

export async function listUserAssessments(userId: string, type: CourseAssessmentType) {
  const assessments = await prisma.courseAssessment.findMany({
    include: {
      _count: { select: { problems: true } },
      course: { select: { slug: true, title: true } }
    },
    orderBy: { opensAt: "desc" },
    where: {
      course: {
        memberships: {
          some: { userId, status: "active" }
        }
      },
      status: "published",
      type
    }
  });

  return assessments.map((a) => ({
    closesAt: a.closesAt.toISOString(),
    courseSlug: a.course.slug,
    courseTitle: a.course.title,
    dueAt: a.dueAt.toISOString(),
    opensAt: a.opensAt.toISOString(),
    problemCount: a._count.problems,
    scoreboardMode: a.scoreboardMode,
    slug: a.slug,
    summary: a.summary,
    title: a.title
  }));
}

export async function getDashboardStats() {
  const [problems, submissions, courses, contests] = await Promise.all([
    prisma.problem.count({ where: { visibility: "public" } }),
    prisma.submission.count(),
    prisma.course.count(),
    prisma.contest.count({ where: { visibility: "published" } })
  ]);

  return { contests, courses, problems, submissions };
}
