import type { GradedContext } from "../shared/graded-context";

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

export function plagiarismGradedContext(
  type: PlagiarismTarget["type"],
  id: string,
): GradedContext {
  if (type === "assessment") return { type: "assignment", assignmentId: id };
  if (type === "exam") return { type: "exam", examId: id };
  return { type: "contest", contestId: id };
}
