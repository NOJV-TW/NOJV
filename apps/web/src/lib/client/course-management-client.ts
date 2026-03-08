import {
  buildActorRequestHeaders,
  courseAssessmentCreateSchema,
  courseCreateSchema,
  courseJoinRequestSchema,
  courseProblemAttachSchema,
  manualCourseEnrollmentSchema,
  problemCreateSchema,
  problemTestcaseSetCreateSchema,
  type ActorIdentity,
  type CourseAssessmentCreate,
  type CourseCreate,
  type CourseJoinRequest,
  type CourseProblemAttach,
  type ManualCourseEnrollment,
  type ProblemCreate,
  type ProblemTestcaseSetCreate
} from "@nojv/domain";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function postJson(
  path: string,
  payload: unknown,
  actor: ActorIdentity,
  fetcher: Fetcher = fetch
) {
  const response = await fetcher(path, {
    body: JSON.stringify(payload),
    headers: {
      ...buildActorRequestHeaders(actor),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const body = (await response.json().catch(() => null)) as { message?: string } | null;

  if (!response.ok) {
    throw new Error(body?.message ?? `Request failed: ${path}`);
  }

  return body;
}

export function createCourseMutation(
  payload: CourseCreate,
  actor: ActorIdentity,
  fetcher?: Fetcher
) {
  return postJson("/api/courses", courseCreateSchema.parse(payload), actor, fetcher);
}

export function createProblemMutation(
  payload: ProblemCreate,
  actor: ActorIdentity,
  fetcher?: Fetcher
) {
  return postJson("/api/problems", problemCreateSchema.parse(payload), actor, fetcher);
}

export function joinCourseMutation(
  payload: CourseJoinRequest,
  actor: ActorIdentity,
  fetcher?: Fetcher
) {
  const parsed = courseJoinRequestSchema.parse(payload);

  return postJson(`/api/courses/${parsed.courseSlug}/join`, parsed, actor, fetcher);
}

export function enrollCourseMemberMutation(
  payload: ManualCourseEnrollment,
  actor: ActorIdentity,
  fetcher?: Fetcher
) {
  const parsed = manualCourseEnrollmentSchema.parse(payload);

  return postJson(`/api/courses/${parsed.courseSlug}/members`, parsed, actor, fetcher);
}

export function attachProblemToCourseMutation(
  payload: CourseProblemAttach,
  actor: ActorIdentity,
  fetcher?: Fetcher
) {
  const parsed = courseProblemAttachSchema.parse(payload);

  return postJson(`/api/courses/${parsed.courseSlug}/problems`, parsed, actor, fetcher);
}

export function publishCourseAssessmentMutation(
  payload: CourseAssessmentCreate,
  actor: ActorIdentity,
  fetcher?: Fetcher
) {
  const parsed = courseAssessmentCreateSchema.parse(payload);

  return postJson(`/api/courses/${parsed.courseSlug}/assessments`, parsed, actor, fetcher);
}

export function createProblemTestcaseSetMutation(
  problemSlug: string,
  payload: ProblemTestcaseSetCreate,
  actor: ActorIdentity,
  fetcher?: Fetcher
) {
  return postJson(
    `/api/problems/${problemSlug}/testcase-sets`,
    problemTestcaseSetCreateSchema.parse(payload),
    actor,
    fetcher
  );
}
