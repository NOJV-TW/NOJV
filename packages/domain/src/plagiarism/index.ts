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
  listAssessmentPlagiarismReports,
  getAssessmentProblemMap,
  type PlagiarismSubmission,
  type ResolvedPlagiarismTarget,
} from "./queries";
export { dispatchPlagiarismCheck } from "@nojv/job-dispatch";
