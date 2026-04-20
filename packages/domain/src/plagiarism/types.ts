export interface SimilarityPair {
  problemId: string;
  userId1: string;
  userId2: string;
  similarity: number;
  longest: number;
  overlap: number;
}

export interface PlagiarismResults {
  pairs: SimilarityPair[];
}

export type PlagiarismTarget =
  | { type: "courseAssessment"; id: string }
  | { type: "exam"; id: string };

export function plagiarismTargetFilter(target: PlagiarismTarget) {
  return target.type === "courseAssessment"
    ? { courseAssessmentId: target.id }
    : { examId: target.id };
}
