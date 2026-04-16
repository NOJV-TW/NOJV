import {
  announcementRepo,
  assessmentRepo,
  courseMembershipRepo,
  courseRepo,
  examRepo,
  problemRepo
} from "@nojv/db";
import type { CourseRole, Language, PlatformRole } from "@nojv/core";

export interface CourseMemberRecord {
  courseRole: CourseRole;
  displayName: string;
  email: string;
  username: string | null;
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
  summary: string;
  title: string;
}

export async function findCourseWithMembership(courseId: string, userId: string) {
  return courseRepo.findByIdWithUserMembership(courseId, userId);
}

export async function getCourseHeaderById(courseId: string, userId: string) {
  return courseRepo.findByIdWithHeader(courseId, userId);
}

export async function listCourseCards(userId?: string) {
  const persistedCourses = await courseRepo.listCards(userId);

  return persistedCourses.map((course) => ({
    assessmentCount: course._count.assessments,
    memberCount: course._count.memberships,
    id: course.id,
    title: course.title
  }));
}

export interface CourseListingCard {
  id: string;
  title: string;
  description: string;
  ownerDisplayName: string;
  role: CourseRole;
  archived: boolean;
  studentCount: number;
  assignmentCount: number;
  examCount: number;
  openAssignments: number;
  draftAssignments: number;
  upcomingExams: number;
  myDueCount: number;
  myUpcomingCount: number;
  myAllCaughtUp: boolean;
}

// `managing` includes teacher + ta memberships; inactive memberships are already filtered upstream.
export async function listForUserWithCards(userId: string): Promise<{
  enrolled: CourseListingCard[];
  managing: CourseListingCard[];
}> {
  const memberships = await courseMembershipRepo.listActiveForUser(userId);
  if (memberships.length === 0) return { enrolled: [], managing: [] };

  const roleByCourseId = new Map<string, CourseRole>();
  for (const m of memberships) {
    roleByCourseId.set(m.courseId, m.role);
  }
  const courseIds = [...roleByCourseId.keys()];

  const now = new Date();
  const [courses, openGroups, draftGroups, upcomingExamGroups] = await Promise.all([
    courseRepo.findManyForCards(courseIds),
    assessmentRepo.groupOpenCountsByCourse(courseIds, now),
    assessmentRepo.groupDraftCountsByCourse(courseIds),
    examRepo.groupUpcomingCountsByCourse(courseIds, now)
  ]);

  const openByCourseId = new Map(openGroups.map((g) => [g.courseId, g._count._all]));
  const draftByCourseId = new Map(draftGroups.map((g) => [g.courseId, g._count._all]));
  const upcomingExamsByCourseId = new Map(
    upcomingExamGroups.map((g) => [g.courseId, g._count._all])
  );

  const cards: CourseListingCard[] = courses.map((course) => {
    const role = roleByCourseId.get(course.id) ?? "student";
    const openAssignments = openByCourseId.get(course.id) ?? 0;
    const draftAssignments = draftByCourseId.get(course.id) ?? 0;
    const upcomingExams = upcomingExamsByCourseId.get(course.id) ?? 0;

    // Student "due / upcoming" approximation: counts open-assignments / upcoming-exams, not per-user unsolved work.
    const myDueCount = openAssignments;
    const myUpcomingCount = upcomingExams;

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      ownerDisplayName: course.owner.name,
      role,
      archived: false,
      studentCount: course._count.memberships,
      assignmentCount: course._count.assessments,
      examCount: course._count.exams,
      openAssignments,
      draftAssignments,
      upcomingExams,
      myDueCount,
      myUpcomingCount,
      myAllCaughtUp: myDueCount === 0 && myUpcomingCount === 0
    };
  });

  const enrolled: CourseListingCard[] = [];
  const managing: CourseListingCard[] = [];
  for (const card of cards) {
    if (card.role === "student") enrolled.push(card);
    else managing.push(card);
  }

  return { enrolled, managing };
}

export async function listUserAssessments(userId: string) {
  const assessments = await assessmentRepo.listByUser(userId);

  return assessments.map((a) => ({
    closesAt: a.closesAt.toISOString(),
    courseId: a.course.id,
    courseTitle: a.course.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    id: a.id,
    opensAt: a.opensAt.toISOString(),
    problemCount: a._count.problems,
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
    courseId: a.course.id,
    courseTitle: a.course.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    id: a.id,
    opensAt: a.opensAt.toISOString(),
    title: a.title
  }));
}

export interface GetAssessmentContextOptions {
  viewerUserId: string;
  viewerPlatformRole: PlatformRole;
  now?: Date;
}

export interface AssessmentContextResult {
  allowedLanguages: Language[];
  courseId: string;
  /** Assessment id — the readable, URL-facing identifier. */
  assessmentId: string;
  /** Resolved time-window state: `upcoming`, `open`, `closed`. */
  timeStatus: "upcoming" | "open" | "closed";
  /** True when the viewer is a manager (owner/teacher/TA) or platform admin. */
  viewerIsManager: boolean;
}

/**
 * Resolve an assessment by (courseId, assessmentId) for the given viewer.
 *
 * Returns `null` when the assessment is missing, unpublished, or the
 * viewer has no route to it. This masks the existence of the
 * assessment from outsiders — critical because the problem page
 * previously trusted any forged `?course=X&assessment=Y` query param.
 *
 * Authorization:
 * - Platform admins always pass.
 * - Course teachers/TAs pass and get `viewerIsManager: true`.
 * - Enrolled students pass only when the assessment's time window is
 *   currently open (upcoming/closed both reject).
 */
// intentional-nullable: the /problems/[id] loader is shared by practice, assignment, and contest modes — a missing or unauthorized assessment must silently fall back to practice-mode, not throw.
export async function getAssessmentContext(
  courseId: string,
  assessmentId: string,
  options: GetAssessmentContextOptions
): Promise<AssessmentContextResult | null> {
  const assessment = await assessmentRepo.findPublishedContextById(courseId, assessmentId);
  if (!assessment) return null;

  const now = options.now ?? new Date();
  const timeStatus: "upcoming" | "open" | "closed" =
    now < assessment.opensAt ? "upcoming" : now > assessment.closesAt ? "closed" : "open";

  const isAdmin = options.viewerPlatformRole === "admin";
  const membership = await courseMembershipRepo.findByComposite(
    assessment.course.id,
    options.viewerUserId
  );
  const isCourseOwner = assessment.course.ownerId === options.viewerUserId;
  const isCourseManager =
    membership?.status === "active" &&
    (membership.role === "teacher" || membership.role === "ta");
  const isEnrolledStudent = membership?.status === "active" && membership.role === "student";

  // Course creator keeps manager rights even if their membership was
  // later removed — only teachers can create courses, so ownership
  // indicates a deliberate, policy-level grant.
  const viewerIsManager = isAdmin || isCourseManager || isCourseOwner;

  if (!viewerIsManager) {
    // Non-members never see the assessment exists.
    if (!isEnrolledStudent) return null;
    // Enrolled students lose access outside the time window.
    if (timeStatus !== "open") return null;
    // Archived courses keep score visibility but lock click-through
    // into problem detail / submission. Returning null here means a
    // student typing the URL directly hits the same closed door as
    // the UI rendering.
    if (assessment.course.archived) return null;
  }

  return {
    allowedLanguages: assessment.allowedLanguages as Language[],
    assessmentId: assessment.id,
    courseId: assessment.course.id,
    timeStatus,
    viewerIsManager
  };
}
