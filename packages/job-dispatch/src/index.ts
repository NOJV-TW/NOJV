export {
  dispatchSubmissionJudge,
  dispatchRejudge,
  dispatchContestLifecycle,
  dispatchAssessmentLifecycle,
  dispatchExamAutoClose,
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
  ExamAutoCloseInput,
  PlagiarismCheckInput,
  SubmissionJudgeStatus,
  PlagiarismCheckStatus,
  RejudgeProgress
} from "./dispatch";

export { closeClient } from "./client";
