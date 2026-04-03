import {
  announcementRepo,
  assessmentParticipationRepo,
  assessmentRepo,
  courseRepo,
  problemRepo,
  runTransaction
} from "@nojv/db";
import type {
  AssessmentScoreboardMode,
  CourseJoinMethod,
  CourseRole,
  Language,
  LocaleCode,
  PlatformRole,
  ProblemVisibility
} from "@nojv/core";
import { DEFAULT_LOCALE } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { checkIpLock } from "../shared/ip-utils";
import { pickProblemStatement } from "../shared/pick-problem-statement";

// ─── Types ───────────────────────────────────────────────────────────

export interface CourseMemberRecord {
  courseRole: CourseRole;
  displayName: string;
  email: string;
  username: string | null;
  joinedVia: CourseJoinMethod;
  platformRole: PlatformRole;
  userId: string;
}

export interface CourseAssessmentRecord {
  allowedLanguages: Language[];
  closesAt: string;
  dueAt: string;
  id: string;
  ipBindingEnabled: boolean;
  ipViolationMode: "block" | "notify";
  ipWhitelist: string[];
  ipWhitelistEnabled: boolean;
  opensAt: string;
  pageLockEnabled: boolean;
  problemSlugs: string[];
  scoreboardMode: AssessmentScoreboardMode;
  slug: string;
  summary: string;
  title: string;
}

export interface CourseProblemCatalogEntry {
  authorUsername: string;
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
  author?: { username: string | null } | null;
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
    authorUsername: problem.author?.username ?? "course_staff",
    slug: problem.slug,
    summary: problem.summary.trim().length > 0 ? problem.summary : localized.statement,
    title: localized.title,
    visibility: problem.visibility
  } satisfies CourseProblemCatalogEntry;
}

function mapAssessmentRecord(assessment: {
  allowedLanguages: Language[];
  closesAt: Date;
  dueAt: Date;
  id: string;
  ipBindingEnabled: boolean;
  ipViolationMode: string;
  ipWhitelist: string[];
  ipWhitelistEnabled: boolean;
  opensAt: Date;
  pageLockEnabled: boolean;
  problems: { ordinal: number; problem: { slug: string } }[];
  scoreboardMode: AssessmentScoreboardMode;
  slug: string;
  summary: string;
  title: string;
}) {
  const linkedProblems = assessment.problems;

  return {
    allowedLanguages: assessment.allowedLanguages,
    closesAt: assessment.closesAt.toISOString(),
    dueAt: assessment.dueAt.toISOString(),
    id: assessment.id,
    ipBindingEnabled: assessment.ipBindingEnabled,
    ipViolationMode: assessment.ipViolationMode as "block" | "notify",
    ipWhitelist: assessment.ipWhitelist,
    ipWhitelistEnabled: assessment.ipWhitelistEnabled,
    opensAt: assessment.opensAt.toISOString(),
    pageLockEnabled: assessment.pageLockEnabled,
    problemSlugs: [...linkedProblems]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((link) => link.problem.slug),
    scoreboardMode: assessment.scoreboardMode,
    slug: assessment.slug,
    summary: assessment.summary,
    title: assessment.title
  } satisfies CourseAssessmentRecord;
}

function mapCourseMember(member: {
  joinedVia: "join_code" | "manual_invite" | "qr_code" | null;
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
    joinedVia: member.joinedVia ?? "manual_invite",
    platformRole: member.user.platformRole,
    userId: member.userId
  } satisfies CourseMemberRecord;
}

function mapPersistedCourse(course: {
  assessments: {
    allowedLanguages: Language[];
    closesAt: Date;
    dueAt: Date;
    id: string;
    ipBindingEnabled: boolean;
    ipViolationMode: string;
    ipWhitelist: string[];
    ipWhitelistEnabled: boolean;
    opensAt: Date;
    pageLockEnabled: boolean;
    problems: { ordinal: number; problem: { slug: string } }[];
    scoreboardMode: AssessmentScoreboardMode;
    slug: string;
    summary: string;
    title: string;
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
      username: string | null;
      platformRole: "admin" | "student" | "teacher";
    };
    userId: string;
  }[];
  problems: {
    problem: {
      author?: { username: string | null } | null;
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
  const persistedCourses = await courseRepo.listCards(userId);

  return persistedCourses.map((course) => ({
    assessmentCount: course._count.assessments,
    memberCount: course._count.memberships,
    slug: course.slug,
    title: course.title
  }));
}

export async function getCoursePageData(slug: string): Promise<CoursePageDetailData | null> {
  const persistedCourse = await courseRepo.findDetailBySlug(slug);

  if (!persistedCourse) {
    return null;
  }

  return mapPersistedCourse(persistedCourse);
}

export async function listUserAssessments(userId: string) {
  const assessments = await assessmentRepo.listByUser(userId);

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
    dueAt: a.dueAt.toISOString(),
    opensAt: a.opensAt.toISOString(),
    slug: a.slug,
    title: a.title
  }));
}

// ─── Assessment detail (data-fetching core) ─────────────────────────

export interface AssessmentDetailInput {
  assessmentSlug: string;
  courseData: CoursePageDetailData;
  /** The authenticated user's ID, or null if anonymous */
  userId: string | null;
  /** Client IP address for IP lock checking */
  clientIp: string;
}

export interface AssessmentDetailResult {
  assessment: CourseAssessmentRecord;
  course: CoursePageData;
  problems: CourseProblemCatalogEntry[];
}

/**
 * Load assessment detail data, including IP lock enforcement.
 *
 * This is the pure data-fetching logic extracted from the SvelteKit loader.
 * The web layer should call this from its loader and add any presentation
 * concerns (assessmentPresentation, windowState, windowStateColorClass).
 */
export async function loadAssessmentDetail(
  input: AssessmentDetailInput
): Promise<AssessmentDetailResult> {
  const { assessmentSlug, courseData, userId, clientIp } = input;
  const course = courseData.course;
  const assessment = course.assessments.find((entry) => entry.slug === assessmentSlug);

  if (!assessment) {
    throw new NotFoundError("Assignment not found");
  }

  const problemsBySlug = new Map(courseData.problems.map((problem) => [problem.slug, problem]));

  const problems = assessment.problemSlugs
    .map((ps) => problemsBySlug.get(ps))
    .filter((p): p is NonNullable<typeof p> => p != null);

  // ── IP lock check ──
  const now = new Date();
  const opensAt = new Date(assessment.opensAt);
  const closesAt = new Date(assessment.closesAt);

  // IP lock applies during open or grace window
  const windowIsActive = now >= opensAt && now <= closesAt;

  if (
    userId &&
    windowIsActive &&
    (assessment.ipWhitelistEnabled || assessment.ipBindingEnabled)
  ) {
    await runTransaction(async (tx) => {
      const participation = await assessmentParticipationRepo
        .withTx(tx)
        .upsert(userId, assessment.id);

      const ipResult = await checkIpLock(
        tx,
        assessment,
        clientIp,
        participation,
        { userId, assessmentId: assessment.id },
        "assessmentParticipation"
      );

      if (!ipResult.allowed && assessment.ipViolationMode === "block") {
        throw new ForbiddenIpError(
          ipResult.violationType === "whitelist"
            ? "Your IP address is not in the allowed range for this assessment."
            : "Your IP address does not match the one bound to your session."
        );
      }
    });
  }

  return {
    assessment,
    course,
    problems
  };
}

/** Thrown when IP lock check fails with block mode. Status 403. */
export class ForbiddenIpError extends Error {
  public readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenIpError";
  }
}

// ─── Assessment context ─────────────────────────────────────────────

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
