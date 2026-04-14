import { announcementRepo, assessmentRepo, courseRepo, problemRepo } from "@nojv/db";
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
