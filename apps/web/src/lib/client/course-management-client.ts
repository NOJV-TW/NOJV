import {
  courseAssessmentCreateSchema,
  courseCreateSchema,
  courseJoinRequestSchema,
  courseProblemAttachSchema,
  manualCourseEnrollmentSchema,
  problemCreateSchema,
  problemTestcaseSetCreateSchema,
  type CourseAssessmentCreate,
  type CourseCreate,
  type CourseJoinRequest,
  type CourseProblemAttach,
  type ManualCourseEnrollment,
  type ProblemCreate,
  type ProblemTestcaseSetCreate
} from "@nojv/domain";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function postJson(path: string, payload: unknown, fetcher: Fetcher = fetch) {
  const response = await fetcher(path, {
    body: JSON.stringify(payload),
    headers: {
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

export function createCourseMutation(payload: CourseCreate, fetcher?: Fetcher) {
  return postJson("/api/courses", courseCreateSchema.parse(payload), fetcher);
}

export function createProblemMutation(payload: ProblemCreate, fetcher?: Fetcher) {
  return postJson("/api/problems", problemCreateSchema.parse(payload), fetcher);
}

export function joinCourseMutation(payload: CourseJoinRequest, fetcher?: Fetcher) {
  const parsed = courseJoinRequestSchema.parse(payload);

  return postJson(`/api/courses/${parsed.courseSlug}/join`, parsed, fetcher);
}

export function enrollCourseMemberMutation(payload: ManualCourseEnrollment, fetcher?: Fetcher) {
  const parsed = manualCourseEnrollmentSchema.parse(payload);

  return postJson(`/api/courses/${parsed.courseSlug}/members`, parsed, fetcher);
}

export function attachProblemToCourseMutation(payload: CourseProblemAttach, fetcher?: Fetcher) {
  const parsed = courseProblemAttachSchema.parse(payload);

  return postJson(`/api/courses/${parsed.courseSlug}/problems`, parsed, fetcher);
}

export function publishCourseAssessmentMutation(
  payload: CourseAssessmentCreate,
  fetcher?: Fetcher
) {
  const parsed = courseAssessmentCreateSchema.parse(payload);

  return postJson(`/api/courses/${parsed.courseSlug}/assessments`, parsed, fetcher);
}

export function createProblemTestcaseSetMutation(
  problemSlug: string,
  payload: ProblemTestcaseSetCreate,
  fetcher?: Fetcher
) {
  return postJson(
    `/api/problems/${problemSlug}/testcase-sets`,
    problemTestcaseSetCreateSchema.parse(payload),
    fetcher
  );
}
