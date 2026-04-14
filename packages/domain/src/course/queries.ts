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
  slug: string;
  summary: string;
  title: string;
}

export async function findCourseWithMembership(courseId: string, userId: string) {
  return courseRepo.findByIdWithUserMembership(courseId, userId);
}

/**
 * Fetch a course with everything the `/courses/[courseId]` layout needs:
 * the current user's membership row (if any), the owner display name for
 * the hero, and published-count aggregates for the tab badges. Returns
 * `null` if the course does not exist.
 */
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

/**
 * Card shape surfaced by the /courses listing page. A card always knows:
 *  - the viewer's role in the course (student / ta / teacher),
 *  - batched counts of `studentCount`, `assignmentCount`, `examCount`,
 *  - status bar counters split by role intent (students see "due /
 *    upcoming", staff see "open / draft / exam").
 */
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

/**
 * One-shot fetch for the /courses listing page. Returns the user's
 * enrolled-as-student and managing-as-staff courses in a single batched
 * round-trip set (memberships -> courses -> per-course aggregates). No
 * N+1 — every aggregate query is keyed by `courseId in (...)`.
 *
 * `managing` includes both `teacher` and `ta` memberships. Inactive
 * memberships are skipped at the membership layer.
 */
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

    // Student "due / upcoming" approximation — we count open assignments
    // and upcoming exams, not per-user unsolved work. The prototype wants
    // this to feel personal, but an accurate per-user query would require
    // a submission aggregation at listing time. Defer until we have a
    // real "my work" stats table.
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
    courseId: a.course.id,
    courseTitle: a.course.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    opensAt: a.opensAt.toISOString(),
    slug: a.slug,
    title: a.title
  }));
}

export async function getAssessmentContext(courseId: string, assessmentSlug: string) {
  const assessment = await assessmentRepo.findPublishedContext(courseId, assessmentSlug);

  return assessment
    ? {
        allowedLanguages: assessment.allowedLanguages as Language[],
        courseId: assessment.course.id,
        slug: assessment.slug
      }
    : null;
}
