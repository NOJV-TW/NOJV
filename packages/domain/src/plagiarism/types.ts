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

export type PlagiarismTarget =
  | { type: "courseAssessment"; id: string }
  | { type: "contest"; id: string };

export function plagiarismTargetFilter(target: PlagiarismTarget) {
  return target.type === "courseAssessment"
    ? { courseAssessmentId: target.id }
    : { contestId: target.id };
}
