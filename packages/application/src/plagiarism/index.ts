export {
  plagiarismTargetFilter,
  type PlagiarismResults,
  type PlagiarismTarget,
  type SimilarityPair,
} from "./types";
export {
  boundaryMarkerFor,
  createPlagiarismReport,
  currentExamReportRun,
  findPlagiarismReport,
  getPlagiarismSourceCode,
  getPlagiarismTarget,
  listAssignmentPlagiarismReports,
  listSubmissionsForCheck,
  markReportFailed,
  saveResults,
  triggerClosedExamReport,
  updateReportStatus,
  type PlagiarismSubmission,
  type ResolvedPlagiarismTarget,
} from "./queries";
export { dispatchPlagiarismCheck } from "./dispatch";
export {
  buildPairKey,
  flagPair,
  unflagPair,
  listFlagsForContext,
  type FlagPairInput,
  type PlagiarismContext,
} from "./flags";
