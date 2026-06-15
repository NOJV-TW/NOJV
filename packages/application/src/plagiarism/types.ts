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
  | { type: "assessment"; id: string }
  | { type: "exam"; id: string }
  | { type: "contest"; id: string };

export function plagiarismTargetFilter(target: PlagiarismTarget) {
  if (target.type === "assessment") return { assessmentId: target.id };
  if (target.type === "exam") return { examId: target.id };
  return { contestId: target.id };
}
