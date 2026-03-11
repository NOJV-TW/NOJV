import { error } from "@sveltejs/kit";
import { prisma } from "@nojv/db";
import type {
  CourseAssessmentType,
  CourseJoinMethod,
  CourseRole,
  LocaleCode,
  PlatformRole
} from "@nojv/domain";

import { DEFAULT_LOCALE } from "$lib/i18n";
import {
  deriveAssessmentPresentation,
  deriveAssessmentWindowState,
  windowStateColorClass
} from "$lib/types";
import {
  starterByLanguage,
  type ProblemDetail,
  type TemplateInfo
} from "$lib/types";

// ─── Types ───────────────────────────────────────────────────────────

export interface CourseMemberRecord {
  courseRole: CourseRole;
  displayName: string;
  email: string;
  handle: string | null;
  joinedVia: CourseJoinMethod;
  platformRole: PlatformRole;
  userId: string;
}

export interface CourseAssessmentRecord {
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

export interface CoursePageData {
  assessments: CourseAssessmentRecord[];
  description: string;
  joinChannels: {
    label: string;
    method: CourseJoinMethod;
    token: string;
  }[];
  locale: LocaleCode;
  members: CourseMemberRecord[];
  problemSlugs: string[];
  slug: string;
  title: string;
}

export interface CoursePageDetailData {
  course: CoursePageData;
  problems: CourseProblemCatalogEntry[];
}

// ─── Internal helper functions (from read-model.ts) ──────────────────

function pickProblemStatement(
  statements:
    | {
        bodyMarkdown: string;
        inputFormat?: string;
        locale: string;
        outputFormat?: string;
        title: string;
      }[]
    | undefined,
  locale: string,
  fallbackTitle: string,
  fallbackStatement: string
) {
  const localized =
    statements?.find((statement) => statement.locale === locale) ?? statements?.[0] ?? null;

  return {
    inputFormat: localized?.inputFormat ?? "",
    outputFormat: localized?.outputFormat ?? "",
    statement: localized?.bodyMarkdown ?? fallbackStatement,
    title: localized?.title ?? fallbackTitle
  };
}

function mapProblemShelfEntry(problem: {
  author?: { handle: string | null } | null;
  slug: string;
  statements?: {
    bodyMarkdown: string;
    inputFormat?: string;
    locale: string;
    outputFormat?: string;
    title: string;
  }[];
  summary: string;
  visibility: "private" | "public";
}) {
  const localized = pickProblemStatement(
    problem.statements,
    DEFAULT_LOCALE,
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
  } satisfies CourseAssessmentRecord;
}

function mapCourseMember(member: {
  joinedVia: "join_code" | "manual_invite" | "qr_code" | null;
  role: "student" | "ta" | "teacher";
  user: {
    name: string;
    email: string;
    handle: string | null;
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
  } satisfies CourseMemberRecord;
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
      handle: string | null;
      platformRole: "admin" | "student" | "teacher";
    };
    userId: string;
  }[];
  problems: {
    problem: {
      author?: { handle: string | null } | null;
      slug: string;
      statements?: {
        bodyMarkdown: string;
        inputFormat?: string;
        locale: string;
        outputFormat?: string;
        title: string;
      }[];
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

function buildTemplatesMap(
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }[]
): Partial<Record<string, TemplateInfo>> {
  const map: Partial<Record<string, TemplateInfo>> = {};

  for (const tpl of templates) {
    map[tpl.language] = {
      driverCode: tpl.driverCode,
      insertionMarker: tpl.insertionMarker,
      templateCode: tpl.templateCode
    };
  }

  return map;
}

function buildStarterByLanguage(
  submissionType: string,
  templates: {
    language: string;
    templateCode: string;
  }[]
): Record<string, string> {
  if (submissionType === "function" && templates.length > 0) {
    const starter: Record<string, string> = { ...starterByLanguage };

    for (const tpl of templates) {
      starter[tpl.language] = tpl.templateCode;
    }

    return starter;
  }

  return { ...starterByLanguage };
}

function mapPersistedProblemDetail(
  problem: {
    author?: { handle: string | null } | null;
    checkerScript?: string | null;
    defaultTitle: string;
    difficulty: string;
    interactorScript?: string | null;
    judgeType?: string;
    memoryLimitMb?: number;
    slug: string;
    statements?: {
      bodyMarkdown: string;
      inputFormat?: string;
      locale: string;
      outputFormat?: string;
      title: string;
    }[];
    submissionType?: string;
    summary: string;
    tags?: string[];
    templates?: {
      driverCode: string;
      insertionMarker: string;
      language: string;
      templateCode: string;
    }[];
    testcaseSets?: {
      isHidden: boolean;
      testcases: {
        expectedStdout: string | null;
        stdin: string;
      }[];
    }[];
    timeLimitMs?: number;
    visibility: "private" | "public";
  },
  locale: string,
  totalSubmissions: number,
  acceptedCount: number
) {
  const localized = pickProblemStatement(
    problem.statements,
    locale,
    problem.defaultTitle,
    problem.summary
  );

  const submissionType = (problem.submissionType ?? "full_source") as "full_source" | "function";
  const problemTemplates = problem.templates ?? [];

  return {
    acceptanceRate: totalSubmissions > 0 ? acceptedCount / totalSubmissions : 0,
    authorHandle: problem.author?.handle ?? "course_staff",
    ...(problem.checkerScript ? { checkerScript: problem.checkerScript } : {}),
    difficulty: problem.difficulty as "easy" | "hard" | "medium",
    ...(problem.interactorScript ? { interactorScript: problem.interactorScript } : {}),
    inputFormat: localized.inputFormat,
    judgeType: (problem.judgeType ?? "standard") as "checker" | "interactive" | "standard",
    memoryLimitMb: problem.memoryLimitMb ?? 256,
    outputFormat: localized.outputFormat,
    samples: buildProblemSamples(problem),
    slug: problem.slug,
    starterByLanguage: buildStarterByLanguage(submissionType, problemTemplates),
    statement: localized.statement,
    submissionType,
    summary: problem.summary.trim().length > 0 ? problem.summary : localized.statement,
    tags: problem.tags ?? [],
    templates: buildTemplatesMap(problemTemplates),
    timeLimitMs: problem.timeLimitMs ?? 1_000,
    title: localized.title,
    totalSubmissions,
    visibility: problem.visibility
  } satisfies ProblemDetail;
}

// ─── Public query functions (from read-model.ts) ─────────────────────

export async function listCourseCards() {
  const persistedCourses = await prisma.course.findMany({
    include: {
      _count: {
        select: {
          assessments: { where: { status: "published" } },
          memberships: { where: { status: "active" } }
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return persistedCourses.map((course) => ({
    assessmentCount: course._count.assessments,
    memberCount: course._count.memberships,
    slug: course.slug,
    title: course.title
  }));
}

export async function listUserCourseCards(userId: string) {
  const persistedCourses = await prisma.course.findMany({
    include: {
      _count: {
        select: {
          assessments: { where: { status: "published" } },
          memberships: { where: { status: "active" } }
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    where: {
      memberships: {
        some: { userId, status: "active" }
      }
    }
  });

  return persistedCourses.map((course) => ({
    assessmentCount: course._count.assessments,
    memberCount: course._count.memberships,
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
  const acceptedByProblemId = new Map(acceptedCounts.map((r) => [r.problemId, r._count]));

  return persistedProblems.map((problem) => {
    const total = problem._count.submissions;
    const accepted = acceptedByProblemId.get(problem.id) ?? 0;
    return {
      acceptanceRate: total > 0 ? accepted / total : 0,
      difficulty: problem.difficulty as "easy" | "hard" | "medium",
      slug: problem.slug,
      tags: problem.tags,
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
    tags: problem.tags,
    title: problem.defaultTitle,
    visibility: problem.visibility
  }));
}

export async function getProblemPageData(slug: string, locale: string = DEFAULT_LOCALE) {
  const persistedProblem = await prisma.problem.findUnique({
    include: {
      _count: {
        select: {
          submissions: true
        }
      },
      author: {
        select: {
          handle: true
        }
      },
      statements: true,
      templates: {
        orderBy: {
          language: "asc"
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

  const acceptedCount = await prisma.submission.count({
    where: { problemId: persistedProblem.id, status: "accepted" }
  });

  return mapPersistedProblemDetail(
    persistedProblem,
    locale,
    persistedProblem._count.submissions,
    acceptedCount
  );
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
  const [problems, courses] = await Promise.all([
    prisma.problem.count({ where: { visibility: "public" } }),
    prisma.course.count()
  ]);

  return { courses, problems };
}

export async function listAnnouncements() {
  return prisma.announcement.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 20
  });
}

export async function listUpcomingAssessments(userId: string) {
  const assessments = await prisma.courseAssessment.findMany({
    include: {
      course: { select: { slug: true, title: true } }
    },
    orderBy: { opensAt: "asc" },
    where: {
      course: {
        memberships: {
          some: { userId, status: "active" }
        }
      },
      closesAt: { gte: new Date() },
      status: "published"
    },
    take: 10
  });

  return assessments.map((a) => ({
    closesAt: a.closesAt.toISOString(),
    courseSlug: a.course.slug,
    courseTitle: a.course.title,
    dueAt: a.dueAt.toISOString(),
    opensAt: a.opensAt.toISOString(),
    slug: a.slug,
    title: a.title,
    type: a.type
  }));
}

// ─── Assessment detail loader (from assessment-detail-loader.ts) ─────

export function createAssessmentDetailLoader(type: CourseAssessmentType) {
  return async ({ params, parent }: { params: { assessmentSlug: string; slug: string }; parent: () => Promise<{ courseData: { course: any; problems: any[] } }> }) => {
    const { assessmentSlug } = params;

    const { courseData } = await parent();
    const course = courseData?.course;
    const assessment = course?.assessments.find((entry: any) => entry.slug === assessmentSlug);

    if (!course || assessment?.type !== type) {
      const label = type === "assignment" ? "Assignment" : "Exam";
      error(404, `${label} not found`);
    }

    const problemsBySlug = new Map(
      (courseData?.problems ?? []).map((problem: any) => [problem.slug, problem])
    );

    const presentation = deriveAssessmentPresentation({
      scoreboardMode: assessment.scoreboardMode,
      type: assessment.type
    });
    const windowState = deriveAssessmentWindowState({
      closesAt: assessment.closesAt,
      dueAt: assessment.dueAt,
      opensAt: assessment.opensAt
    });

    const problems = assessment.problemSlugs
      .map((ps: string) => problemsBySlug.get(ps))
      .filter((p: any): p is NonNullable<typeof p> => p != null);

    return {
      assessment,
      course,
      presentation,
      problems,
      type,
      windowState
    };
  };
}

// ─── Assessment list loader (from assessment-list-loader.ts) ─────────

export function createAssessmentListLoader(type: CourseAssessmentType) {
  return async ({ locals }: { locals: App.Locals }) => {
    const userId = locals.user?.id ?? null;

    if (!userId) {
      return { items: null };
    }

    const items = await listUserAssessments(userId, type);
    const now = new Date().toISOString();

    return {
      items: items.map((a) => {
        const windowState = deriveAssessmentWindowState({
          closesAt: a.closesAt,
          dueAt: a.dueAt,
          now,
          opensAt: a.opensAt
        });
        return {
          ...a,
          windowState,
          windowStateColor: windowStateColorClass(windowState)
        };
      })
    };
  };
}
