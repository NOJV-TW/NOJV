export type SubmissionContextKind = "exam" | "contest" | "assignment" | "practice";

export function deriveSubmissionContextKind(fks: {
  contestId: string | null;
  assessmentId: string | null;
  examId: string | null;
}): SubmissionContextKind {
  if (fks.examId) return "exam";
  if (fks.contestId) return "contest";
  if (fks.assessmentId) return "assignment";
  return "practice";
}

export function buildSubmissionContext(submission: {
  contestId: string | null;
  contest: { id: string; title: string } | null;
  assessmentId: string | null;
  assessment: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; title: string };
  } | null;
  examId: string | null;
  exam: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; title: string };
  } | null;
}) {
  if (submission.contest) {
    return {
      kind: "contest" as const,
      contestId: submission.contest.id,
      contestTitle: submission.contest.title,
    };
  }
  if (submission.assessment) {
    return {
      kind: "assignment" as const,
      assignmentId: submission.assessment.id,
      assignmentTitle: submission.assessment.title,
      courseId: submission.assessment.course.id,
      courseTitle: submission.assessment.course.title,
    };
  }
  if (submission.exam) {
    return {
      kind: "exam" as const,
      examId: submission.exam.id,
      examTitle: submission.exam.title,
      courseId: submission.exam.course.id,
      courseTitle: submission.exam.course.title,
    };
  }
  return { kind: "practice" as const };
}
