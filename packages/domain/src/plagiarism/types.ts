export interface SimilarityPair {
  linesMatched: number;
  mossUrl: string;
  problemId: string;
  similarity1: number;
  similarity2: number;
  userId1: string;
  userId2: string;
}

export interface PlagiarismResults {
  pairs: SimilarityPair[];
}

// Plagiarism checks run on course homework assessments and course
// exams. Standalone contests no longer support plagiarism — the
// MOSS workflow was always tied to course membership.
export type PlagiarismTarget =
  | { type: "courseAssessment"; id: string }
  | { type: "exam"; id: string };

export function plagiarismTargetFilter(target: PlagiarismTarget) {
  return target.type === "courseAssessment"
    ? { courseAssessmentId: target.id }
    : { examId: target.id };
}
