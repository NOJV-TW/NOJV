export * from "./types";
export * from "./task-queues";
export { getTemporalClient, closeTemporalClient } from "./client";
// Backward-compatible alias preserved from the former @nojv/job-dispatch surface.
export { closeTemporalClient as closeClient } from "./client";
export {
  dispatchSubmissionJudge,
  dispatchRejudge,
  dispatchContestLifecycle,
  dispatchAssessmentLifecycle,
  dispatchExamAutoClose,
  dispatchPlagiarismCheck,
  querySubmissionStatus,
  queryRejudgeProgress,
  queryPlagiarismStatus,
} from "./dispatch";
