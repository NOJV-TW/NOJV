import { prisma } from "@nojv/db";

import {
  courseCards,
  getCourseDetail,
  getCourseProblemCatalog,
  type CoursePocAssessment,
  type CoursePocDetail,
  type CoursePocMember,
  type CourseProblemCatalogEntry
} from "../course-poc-data";
import {
  getProblemDetail,
  problemCards,
  starterByLanguage,
  type ProblemDetail
} from "../demo-data";

export type CoursePageData = CoursePocDetail & { assessments: CoursePocAssessment[] };

export interface CoursePageDetailData {
  course: CoursePageData;
  problems: CourseProblemCatalogEntry[];
}

function mergeBySlug<T extends { slug: string }>(seeded: T[], persisted: T[]) {
  const persistedBySlug = new Map(persisted.map((entry) => [entry.slug, entry]));
  const merged = seeded.map((entry) => persistedBySlug.get(entry.slug) ?? entry);
  const seededSlugs = new Set(seeded.map((entry) => entry.slug));

  for (const entry of persisted) {
    if (!seededSlugs.has(entry.slug)) {
      merged.push(entry);
    }
  }

  return merged;
}

function calculateAcceptanceRate(
  submissionStatuses: { status: string }[] | undefined,
  seededProblem?: ProblemDetail
) {
  if (!submissionStatuses || submissionStatuses.length === 0) {
    return seededProblem?.acceptanceRate ?? 0;
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

function mapProblemCatalogCard(problem: {
  defaultTitle: string;
  difficulty: string;
  slug: string;
  submissions?: { status: string }[];
}) {
  const seededProblem = getProblemDetail(problem.slug);
  const totalSubmissions = problem.submissions?.length ?? seededProblem?.totalSubmissions ?? 0;

  return {
    acceptanceRate: calculateAcceptanceRate(problem.submissions, seededProblem),
    difficulty: problem.difficulty as "easy" | "hard" | "medium",
    slug: problem.slug,
    title: problem.defaultTitle,
    totalSubmissions
  };
}

function mapProblemShelfEntry(problem: {
  author?: { handle: string } | null;
  slug: string;
  statements?: { bodyMarkdown: string; locale: string; title: string }[];
  summary: string;
  visibility: "private" | "public";
}) {
  const seededProblem = getProblemDetail(problem.slug);
  const localized = pickProblemStatement(
    problem.statements,
    "zh-TW",
    seededProblem?.title ?? problem.slug,
    seededProblem?.statement ?? problem.summary
  );
  const summary =
    problem.summary.trim().length > 0
      ? problem.summary
      : (seededProblem?.summary ?? localized.statement);

  return {
    authorHandle: problem.author?.handle ?? seededProblem?.authorHandle ?? "course_staff",
    slug: problem.slug,
    summary,
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
    displayName: string;
    email: string;
    handle: string;
    platformRole: "admin" | "student" | "ta" | "teacher";
  };
  userId: string;
}) {
  return {
    courseRole: member.role,
    displayName: member.user.displayName,
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
      displayName: string;
      email: string;
      handle: string;
      platformRole: "admin" | "student" | "ta" | "teacher";
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
  slug: string;
  testcaseSets?: {
    isHidden: boolean;
    testcases: {
      expectedStdout: string;
      stdin: string;
    }[];
  }[];
}) {
  const seededProblem = getProblemDetail(problem.slug);

  if (seededProblem?.samples.length) {
    return seededProblem.samples;
  }

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
      output: sample.expectedStdout
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
        expectedStdout: string;
        stdin: string;
      }[];
    }[];
    visibility: "private" | "public";
  },
  locale: string
) {
  const seededProblem = getProblemDetail(problem.slug);
  const localized = pickProblemStatement(
    problem.statements,
    locale,
    seededProblem?.title ?? problem.defaultTitle,
    seededProblem?.statement ?? problem.summary
  );
  const summary =
    problem.summary.trim().length > 0
      ? problem.summary
      : (seededProblem?.summary ?? localized.statement);

  return {
    acceptanceRate: calculateAcceptanceRate(problem.submissions, seededProblem),
    authorHandle: problem.author?.handle ?? seededProblem?.authorHandle ?? "course_staff",
    difficulty: problem.difficulty as "easy" | "hard" | "medium",
    samples: buildProblemSamples(problem),
    slug: problem.slug,
    starterByLanguage: seededProblem?.starterByLanguage ?? starterByLanguage,
    statement: localized.statement,
    summary,
    tags: seededProblem?.tags ?? [],
    title: localized.title,
    totalSubmissions: problem.submissions?.length ?? seededProblem?.totalSubmissions ?? 0,
    visibility: problem.visibility
  } satisfies ProblemDetail;
}

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

  return mergeBySlug(
    courseCards,
    persistedCourses.map((course) => ({
      assessmentCount: course.assessments.length,
      memberCount: course.memberships.length,
      slug: course.slug,
      title: course.title
    }))
  );
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

  if (persistedCourse) {
    return mapPersistedCourse(persistedCourse);
  }

  const seededCourse = getCourseDetail(slug);

  if (!seededCourse) {
    return null;
  }

  return {
    course: seededCourse,
    problems: getCourseProblemCatalog(slug)
  } satisfies CoursePageDetailData;
}

export async function listProblemCards() {
  const persistedProblems = await prisma.problem.findMany({
    include: {
      submissions: {
        select: {
          status: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    where: {
      visibility: "public"
    }
  });

  return mergeBySlug(problemCards, persistedProblems.map(mapProblemCatalogCard));
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

  if (persistedProblem) {
    return mapPersistedProblemDetail(persistedProblem, locale);
  }

  return getProblemDetail(slug);
}
