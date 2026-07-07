import { assessmentRepo, contestRepo, courseMembershipRepo, examRepo } from "@nojv/db";

export type UpcomingAssessmentType = "assignment" | "exam" | "contest";

export interface UpcomingAssessment {
  id: string;
  type: UpcomingAssessmentType;
  title: string;
  courseTitle: string | null;
  opensAt: string;
  closesAt: string;
  dueAt: string | null;
}

export async function listUpcomingAssessments(
  userId: string,
  now: Date = new Date(),
  take = 10,
): Promise<UpcomingAssessment[]> {
  const memberships = await courseMembershipRepo.listActiveForUser(userId);
  const courseIds = memberships.map((m) => m.courseId);

  const [assignments, exams, contests] = await Promise.all([
    assessmentRepo.listUpcoming(userId, now, take),
    courseIds.length > 0 ? examRepo.listByCourseIds(courseIds) : Promise.resolve([]),
    contestRepo.listParticipatedContestsForUser(userId),
  ]);

  const items: UpcomingAssessment[] = [
    ...assignments.map((a): UpcomingAssessment => ({
      id: a.id,
      type: "assignment",
      title: a.title,
      courseTitle: a.course.title,
      opensAt: a.opensAt.toISOString(),
      closesAt: a.closesAt.toISOString(),
      dueAt: a.dueAt?.toISOString() ?? null,
    })),
    ...exams
      .filter((e) => e.endsAt >= now)
      .map((e): UpcomingAssessment => ({
        id: e.id,
        type: "exam",
        title: e.title,
        courseTitle: e.course.title,
        opensAt: e.startsAt.toISOString(),
        closesAt: e.endsAt.toISOString(),
        dueAt: null,
      })),
    ...contests
      .filter((c) => c.endsAt >= now)
      .map((c): UpcomingAssessment => ({
        id: c.id,
        type: "contest",
        title: c.title,
        courseTitle: null,
        opensAt: c.startsAt.toISOString(),
        closesAt: c.endsAt.toISOString(),
        dueAt: null,
      })),
  ];

  items.sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  return items.slice(0, take);
}
