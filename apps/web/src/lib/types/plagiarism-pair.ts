import type { plagiarismDomain } from "@nojv/domain";

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
    sourceCode: string | null;
  };
  right: {
    userId: string;
    displayName: string | null;
    username: string | null;
    sourceCode: string | null;
  };
  flag: {
    id: string;
    flaggedBy: string;
    flaggedAt: string;
    note: string | null;
  } | null;
}
