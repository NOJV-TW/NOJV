import { error } from "@sveltejs/kit";
import { prisma } from "@nojv/db";
import type {
  AssessmentScoreboardMode,
  CourseAssessmentType,
  CourseJoinMethod,
  CourseRole,
  LocaleCode,
  PlatformRole,
  ProblemVisibility
} from "@nojv/core";

import { DEFAULT_LOCALE } from "$lib/utils";
import {
  deriveAssessmentPresentation,
  deriveAssessmentWindowState,
  windowStateColorClass
} from "$lib/types";
import { pickProblemStatement } from "../shared/pick-problem-statement";

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
  scoreboardMode: AssessmentScoreboardMode;
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
  visibility: ProblemVisibility;
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

// ─── Internal helper functions ───────────────────────────────────────

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
  visibility: ProblemVisibility;
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
  problems: { ordinal: number; problem: { slug: string } }[];
  scoreboardMode: AssessmentScoreboardMode;
  slug: string;
  summary: string;
  title: string;
  type: CourseAssessmentType;
}) {
  const linkedProblems = assessment.problems;

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
    problems: { ordinal: number; problem: { slug: string } }[];
    scoreboardMode: AssessmentScoreboardMode;
    slug: string;
    summary: string;
    title: string;
    type: CourseAssessmentType;
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
      visibility: ProblemVisibility;
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

// ─── Public query functions ──────────────────────────────────────────

export async function listCourseCards(userId?: string) {
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
    ...(userId
      ? {
          where: {
            memberships: {
              some: { userId, status: "active" }
            }
          }
        }
      : {})
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

// ─── Assessment detail loader ────────────────────────────────────────

export function createAssessmentDetailLoader(type: CourseAssessmentType) {
  return async ({
    params,
    parent
  }: {
    params: { assessmentSlug: string; slug: string };
    parent: () => Promise<{ courseData: CoursePageDetailData }>;
  }) => {
    const { assessmentSlug } = params;

    const { courseData } = await parent();
    const course = courseData.course;
    const assessment = course.assessments.find((entry) => entry.slug === assessmentSlug);

    if (assessment?.type !== type) {
      const label = type === "assignment" ? "Assignment" : "Exam";
      error(404, `${label} not found`);
    }

    const problemsBySlug = new Map(
      courseData.problems.map((problem) => [problem.slug, problem])
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
      .map((ps) => problemsBySlug.get(ps))
      .filter((p): p is NonNullable<typeof p> => p != null);

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

// ─── Assessment list loader ──────────────────────────────────────────

export async function getAssessmentContext(courseSlug: string, assessmentSlug: string) {
  const assessment = await prisma.courseAssessment.findFirst({
    select: {
      course: { select: { slug: true } },
      slug: true,
      type: true
    },
    where: {
      course: { slug: courseSlug },
      slug: assessmentSlug,
      status: "published"
    }
  });

  return assessment
    ? { courseSlug: assessment.course.slug, slug: assessment.slug, type: assessment.type }
    : null;
}

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

export async function getActiveExamForUser(userId: string) {
  const now = new Date();

  return prisma.courseAssessment.findFirst({
    where: {
      type: "exam",
      status: "published",
      pageLockEnabled: true,
      opensAt: { lte: now },
      closesAt: { gte: now },
      course: {
        memberships: {
          some: { userId, status: "active" }
        }
      }
    },
    select: {
      slug: true,
      course: { select: { slug: true } }
    }
  });
}
