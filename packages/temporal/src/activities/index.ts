// --- Judge activities (require sandbox/Docker/K8s access) ---

export {
  fetchJudgeContext,
  executeSandbox,
  completeSubmission,
  fetchSubmissionIdsForRejudge,
  setExecutor
} from "./judge";
export type { CompletedSubmission, SubmissionJudgeContext, TestcaseSetGroup } from "./judge";

export { updateUserStats } from "./stats";

// --- Platform activities (DB + Redis + network only) ---

export {
  getContestInfo,
  activateContest,
  freezeScoreboard,
  finalizeContest,
  updateContestScores
} from "./contest";
export type { ContestInfo } from "./contest";

export {
  getAssessmentInfo,
  activateAssessment,
  closeAssessment
} from "./assessment";
export type { AssessmentInfo } from "./assessment";

export { runPlagiarismCheck } from "./plagiarism";

// --- Shared activities (used by both judge and platform) ---

export {
  publishVerdict,
  publishContestEvent,
  publishAssessmentDeadline
} from "./notification";

export {
  getRedis,
  updateScoreboard,
  getScoreboard,
  setCooldown,
  checkCooldown,
  cacheGet,
  cacheSet,
  cacheDel
} from "./redis";
