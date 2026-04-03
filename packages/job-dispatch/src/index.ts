export {
  dispatchSubmissionJudge,
  dispatchRejudge,
  dispatchContestLifecycle,
  dispatchAssessmentLifecycle,
  dispatchPlagiarismCheck,
  querySubmissionStatus,
  queryRejudgeProgress,
  queryPlagiarismStatus
} from "./dispatch";

export type {
  SubmissionJudgeInput,
  RejudgeInput,
  ContestLifecycleInput,
  AssessmentLifecycleInput,
  PlagiarismCheckInput,
  SubmissionJudgeStatus,
  PlagiarismCheckStatus,
  RejudgeProgress
} from "./dispatch";

export { closeClient } from "./client";
