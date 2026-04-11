import { announcementRepo, assessmentRepo, courseRepo, problemRepo } from "@nojv/db";
import type {
  CourseJoinTokenKind,
  CourseRole,
  Language,
  LocaleCode,
  PlatformRole,
  ProblemVisibility
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { localizeProblem } from "../shared/pick-problem-statement";

export interface CourseMemberRecord {
  courseRole: CourseRole;
  displayName: string;
  email: string;
  username: string | null;
  /** Null = teacher manually added this user without a join token. */
  joinedTokenId: string | null;
  platformRole: PlatformRole;
  userId: string;
}

export interface CourseAssessmentRecord {
  allowedLanguages: Language[];
  closesAt: string;
  /** Nullable: assessments without a soft due date have no late penalty. */
  dueAt: string | null;
  id: string;
  opensAt: string;
  problemIds: string[];
  slug: string;
  summary: string;
  title: string;
}

export interface CourseProblemCatalogEntry {
  authorUsername: string;
  id: string;
  /** Mirror of the localized title; the standalone column is gone. */
  summary: string;
  title: string;
  visibility: ProblemVisibility;
}

export interface CoursePageData {
  assessments: CourseAssessmentRecord[];
  description: string;
  joinChannels: {
    kind: CourseJoinTokenKind;
    label: string;
    token: string;
  }[];
  locale: LocaleCode;
  members: CourseMemberRecord[];
  problemIds: string[];
  slug: string;
  title: string;
}

export interface CoursePageDetailData {
  course: CoursePageData;
  problems: CourseProblemCatalogEntry[];
}

function mapProblemShelfEntry(problem: {
  author?: { username: string | null } | null;
  id: string;
  statements?: {
    bodyMarkdown: string;
    inputFormat?: string;
    locale: string;
    outputFormat?: string;
    title: string;
  }[];
  title: string;
  visibility: ProblemVisibility;
}) {
  const localized = localizeProblem(problem);

  return {
    authorUsername: problem.author?.username ?? "course_staff",
    id: problem.id,
    summary: localized.title,
    title: localized.title,
    visibility: problem.visibility
  } satisfies CourseProblemCatalogEntry;
}

interface PersistedAssessmentProblemLink {
  ordinal: number;
  problem: {
    author?: { username: string | null } | null;
    id: string;
    statements?: {
      bodyMarkdown: string;
      inputFormat?: string;
      locale: string;
      outputFormat?: string;
      title: string;
    }[];
    title: string;
    visibility: ProblemVisibility;
  };
}

function mapAssessmentRecord(assessment: {
  allowedLanguages: Language[];
  closesAt: Date;
  dueAt: Date | null;
  id: string;
  opensAt: Date;
  problems: PersistedAssessmentProblemLink[];
  slug: string;
  summary: string;
  title: string;
}) {
  const linkedProblems = assessment.problems;

  return {
    allowedLanguages: assessment.allowedLanguages,
    closesAt: assessment.closesAt.toISOString(),
    dueAt: assessment.dueAt?.toISOString() ?? null,
    id: assessment.id,
    opensAt: assessment.opensAt.toISOString(),
    problemIds: [...linkedProblems]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((link) => link.problem.id),
    slug: assessment.slug,
    summary: assessment.summary,
    title: assessment.title
  } satisfies CourseAssessmentRecord;
}

function mapCourseMember(member: {
  joinedTokenId: string | null;
  role: "student" | "ta" | "teacher";
  user: {
    name: string;
    email: string;
    username: string | null;
    platformRole: "admin" | "student" | "teacher";
  };
  userId: string;
}) {
  return {
    courseRole: member.role,
    displayName: member.user.name,
    email: member.user.email,
    username: member.user.username,
    joinedTokenId: member.joinedTokenId,
    platformRole: member.user.platformRole,
    userId: member.userId
  } satisfies CourseMemberRecord;
}

function mapPersistedCourse(course: {
  assessments: {
    allowedLanguages: Language[];
    closesAt: Date;
    dueAt: Date | null;
    id: string;
    opensAt: Date;
    problems: PersistedAssessmentProblemLink[];
    slug: string;
    summary: string;
    title: string;
  }[];
  description: string;
  joinTokens: {
    kind: "link" | "code";
    label: string;
    token: string;
  }[];
  locale: string;
  memberships: {
    joinedTokenId: string | null;
    role: "student" | "ta" | "teacher";
    user: {
      name: string;
      email: string;
      username: string | null;
      platformRole: "admin" | "student" | "teacher";
    };
    userId: string;
  }[];
  slug: string;
  title: string;
}): CoursePageDetailData {
  const assessments = course.assessments.map(mapAssessmentRecord);
  const members = course.memberships.map(mapCourseMember);

  // A course's problem list is the distinct union of every problem
  // attached to one of its assessments. Dedupe by problemId, first-wins
  // by assessment order (which is `opensAt asc` from the repo).
  const seen = new Set<string>();
  const problems: CourseProblemCatalogEntry[] = [];
  for (const assessment of course.assessments) {
    for (const link of assessment.problems) {
      if (seen.has(link.problem.id)) continue;
      seen.add(link.problem.id);
      problems.push(mapProblemShelfEntry(link.problem));
    }
  }

  return {
    course: {
      assessments,
      description: course.description,
      joinChannels: course.joinTokens.map((token) => ({
        kind: token.kind,
        label: token.label,
        token: token.token
      })),
      locale: course.locale as "en" | "zh-TW",
      members,
      problemIds: problems.map((problem) => problem.id),
      slug: course.slug,
      title: course.title
    } satisfies CoursePageData,
    problems
  } satisfies CoursePageDetailData;
}

export async function findCourseWithMembership(courseSlug: string, userId: string) {
  return courseRepo.findBySlugWithUserMembership(courseSlug, userId);
}

export async function listCourseCards(userId?: string) {
  const persistedCourses = await courseRepo.listCards(userId);

  return persistedCourses.map((course) => ({
    assessmentCount: course._count.assessments,
    memberCount: course._count.memberships,
    slug: course.slug,
    title: course.title
  }));
}

export async function getCoursePageData(slug: string): Promise<CoursePageDetailData> {
  const persistedCourse = await courseRepo.findDetailBySlug(slug);

  if (!persistedCourse) {
    throw new NotFoundError(`Course not found: ${slug}`);
  }

  return mapPersistedCourse(persistedCourse);
}

export async function listUserAssessments(userId: string) {
  const assessments = await assessmentRepo.listByUser(userId);

  return assessments.map((a) => ({
    closesAt: a.closesAt.toISOString(),
    courseSlug: a.course.slug,
    courseTitle: a.course.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    opensAt: a.opensAt.toISOString(),
    problemCount: a._count.problems,
    slug: a.slug,
    summary: a.summary,
    title: a.title
  }));
}

export async function getDashboardStats() {
  const [problems, courses] = await Promise.all([
    problemRepo.countPublic(),
    courseRepo.count()
  ]);

  return { courses, problems };
}

export async function listAnnouncements() {
  return announcementRepo.listPublished(20);
}

export async function listUpcomingAssessments(userId: string) {
  const assessments = await assessmentRepo.listUpcoming(userId, new Date(), 10);

  return assessments.map((a) => ({
    closesAt: a.closesAt.toISOString(),
    courseSlug: a.course.slug,
    courseTitle: a.course.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    opensAt: a.opensAt.toISOString(),
    slug: a.slug,
    title: a.title
  }));
}

export interface AssessmentDetailInput {
  assessmentSlug: string;
  courseData: CoursePageDetailData;
  /** The authenticated user's ID, or null if anonymous */
  userId: string | null;
}

export interface AssessmentDetailResult {
  assessment: CourseAssessmentRecord;
  course: CoursePageData;
  problems: CourseProblemCatalogEntry[];
}

/**
 * Load assessment detail data. Homework assessments no longer have IP
 * lock or page lock — those moved to Contest exclusively. The function
 * is now a pure projection over course data, but kept Promise-shaped so
 * callers don't need to change.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function loadAssessmentDetail(
  input: AssessmentDetailInput
): Promise<AssessmentDetailResult> {
  const { assessmentSlug, courseData } = input;
  const course = courseData.course;
  const assessment = course.assessments.find((entry) => entry.slug === assessmentSlug);

  if (!assessment) {
    throw new NotFoundError("Assignment not found");
  }

  const problemsById = new Map(courseData.problems.map((problem) => [problem.id, problem]));

  const problems = assessment.problemIds
    .map((pid) => problemsById.get(pid))
    .filter((p): p is NonNullable<typeof p> => p != null);

  return {
    assessment,
    course,
    problems
  };
}

export async function getAssessmentContext(courseSlug: string, assessmentSlug: string) {
  const assessment = await assessmentRepo.findPublishedContext(courseSlug, assessmentSlug);

  return assessment
    ? {
        allowedLanguages: assessment.allowedLanguages as Language[],
        courseSlug: assessment.course.slug,
        slug: assessment.slug
      }
    : null;
}
