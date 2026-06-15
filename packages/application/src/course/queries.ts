import {
  assessmentRepo,
  courseMembershipRepo,
  courseRepo,
  examRepo,
  problemRepo,
} from "@nojv/db";
import type { CourseRole, Language, PlatformRole } from "@nojv/core";

import * as announcementDomain from "../announcement";

interface ActorRoleHint {
  platformRole: PlatformRole;
}

export interface CourseMemberRecord {
  courseRole: CourseRole;
  displayName: string;
  email: string;
  username: string | null;
  platformRole: PlatformRole;
  userId: string;
}

export interface AssessmentRecord {
  allowedLanguages: Language[];
  closesAt: string;
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

export interface CopyCoursePreview {
  sourceTitle: string;
  suggestedTitle: string;
  assignments: {
    total: number;
    byStatus: { draft: number; published: number; archived: number };
    problemLinks: number;
  };
  exams: {
    total: number;
    byStatus: { draft: number; published: number; archived: number };
    problemLinks: number;
  };
}

// intentional-nullable: caller needs absence for missing source course.
export async function getCopyCoursePreview(
  courseId: string,
): Promise<CopyCoursePreview | null> {
  const course = await courseRepo.findById(courseId);
  if (!course) return null;
  const [assignments, exams] = await Promise.all([
    assessmentRepo.copyPreviewByCourseId(courseId),
    examRepo.copyPreviewByCourseId(courseId),
  ]);
  return {
    sourceTitle: course.title,
    suggestedTitle: `${course.title} (copy)`,
    assignments,
    exams,
  };
}

export async function listCourseCards(userId?: string) {
  const persistedCourses = await courseRepo.listCards(userId);

  return persistedCourses.map((course) => ({
    assignmentCount: course._count.assessments,
    memberCount: course._count.memberships,
    id: course.id,
    title: course.title,
  }));
}

export interface CourseListingCard {
  id: string;
  title: string;
  description: string;
  ownerDisplayName: string;
  role: CourseRole;
  archived: boolean;
  academicYear: number | null;
  semester: number | null;
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
    examRepo.groupUpcomingCountsByCourse(courseIds, now),
  ]);

  const openByCourseId = new Map(openGroups.map((g) => [g.courseId, g._count._all]));
  const draftByCourseId = new Map(draftGroups.map((g) => [g.courseId, g._count._all]));
  const upcomingExamsByCourseId = new Map(
    upcomingExamGroups.map((g) => [g.courseId, g._count._all]),
  );

  const cards: CourseListingCard[] = courses.map((course) => {
    const role = roleByCourseId.get(course.id) ?? "student";
    const openAssignments = openByCourseId.get(course.id) ?? 0;
    const draftAssignments = draftByCourseId.get(course.id) ?? 0;
    const upcomingExams = upcomingExamsByCourseId.get(course.id) ?? 0;

    const myDueCount = openAssignments;
    const myUpcomingCount = upcomingExams;

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      ownerDisplayName: course.owner.name,
      role,
      archived: false,
      academicYear: course.academicYear,
      semester: course.semester,
      studentCount: course._count.memberships,
      assignmentCount: course._count.assessments,
      examCount: course._count.exams,
      openAssignments,
      draftAssignments,
      upcomingExams,
      myDueCount,
      myUpcomingCount,
      myAllCaughtUp: myDueCount === 0 && myUpcomingCount === 0,
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

export async function listUserAssignments(userId: string) {
  const assignments = await assessmentRepo.listByUser(userId);

  return assignments.map((a) => ({
    closesAt: a.closesAt.toISOString(),
    courseId: a.course.id,
    courseTitle: a.course.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    id: a.id,
    opensAt: a.opensAt.toISOString(),
    problemCount: a._count.problems,
    summary: a.summary,
    title: a.title,
  }));
}

export async function getDashboardStats() {
  const [problems, courses] = await Promise.all([
    problemRepo.countPublic(),
    courseRepo.count(),
  ]);

  return { courses, problems };
}

export async function listAnnouncements(actor?: ActorRoleHint | null) {
  return announcementDomain.listPublicAnnouncements(actor);
}

export async function listUpcomingAssignments(userId: string) {
  const assignments = await assessmentRepo.listUpcoming(userId, new Date(), 10);

  return assignments.map((a) => ({
    closesAt: a.closesAt.toISOString(),
    courseId: a.course.id,
    courseTitle: a.course.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    id: a.id,
    opensAt: a.opensAt.toISOString(),
    title: a.title,
  }));
}

export interface GetAssignmentContextOptions {
  viewerUserId: string;
  viewerPlatformRole: PlatformRole;
  now?: Date;
}

export interface AssignmentContextResult {
  allowedLanguages: Language[];
  courseId: string;
  assignmentId: string;
  timeStatus: "upcoming" | "open" | "closed";
  viewerIsManager: boolean;
}

// intentional-nullable: caller needs absence for inaccessible assignment context.
export async function getAssignmentContext(
  courseId: string,
  assignmentId: string,
  options: GetAssignmentContextOptions,
): Promise<AssignmentContextResult | null> {
  const assignment = await assessmentRepo.findPublishedContextById(courseId, assignmentId);
  if (!assignment) return null;

  const now = options.now ?? new Date();
  let timeStatus: "upcoming" | "open" | "closed" = "open";
  if (now < assignment.opensAt) timeStatus = "upcoming";
  else if (now > assignment.closesAt) timeStatus = "closed";

  const isAdmin = options.viewerPlatformRole === "admin";
  const membership = await courseMembershipRepo.findByComposite(
    assignment.course.id,
    options.viewerUserId,
  );
  const isCourseOwner = assignment.course.ownerId === options.viewerUserId;
  const isCourseManager =
    membership?.status === "active" &&
    (membership.role === "teacher" || membership.role === "ta");
  const isEnrolledStudent = membership?.status === "active" && membership.role === "student";

  const viewerIsManager = isAdmin || isCourseManager || isCourseOwner;

  if (!viewerIsManager) {
    if (!isEnrolledStudent) return null;
    if (timeStatus !== "open") return null;
    if (assignment.course.archived) return null;
  }

  return {
    allowedLanguages: assignment.allowedLanguages,
    assignmentId: assignment.id,
    courseId: assignment.course.id,
    timeStatus,
    viewerIsManager,
  };
}
