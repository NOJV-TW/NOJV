export {
  plagiarismTargetFilter,
  type PlagiarismResults,
  type PlagiarismTarget,
  type SimilarityPair,
} from "./types";
export {
  fetchSubmissionsForCheck,
  updateReportStatus,
  saveResults,
  markReportFailed,
  resolvePlagiarismTarget,
  createPlagiarismReport,
  findPlagiarismReport,
  getPlagiarismSourceCode,
  listAssignmentPlagiarismReports,
  getAssignmentProblemMap,
  type PlagiarismSubmission,
  type ResolvedPlagiarismTarget,
} from "./queries";
export { dispatchPlagiarismCheck } from "@nojv/job-dispatch";
export {
  buildPairKey,
  flagPair,
  unflagPair,
  listFlagsForContext,
  type FlagPairInput,
  type PlagiarismContext,
} from "./flags";
