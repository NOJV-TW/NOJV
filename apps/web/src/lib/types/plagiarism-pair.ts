import type { plagiarismDomain, SubmissionSource } from "@nojv/application";

export interface PlagiarismPairDiffData {
  pair: {
    similarity: number;
    longest: number;
    overlap: number;
    problemId: string;
  };
  pairKey: string;
  contextType: plagiarismDomain.PlagiarismContext;
  contextId: string;
  left: {
    userId: string;
    displayName: string | null;
    username: string | null;
    files: SubmissionSource[] | null;
  };
  right: {
    userId: string;
    displayName: string | null;
    username: string | null;
    files: SubmissionSource[] | null;
  };
  flag: {
    id: string;
    flaggedBy: string;
    flaggedAt: string;
    note: string | null;
  } | null;
}
