// Platform activity bundle — use when deploying platform worker as a microservice.
// Includes contest/assessment lifecycle, plagiarism, and notification activities.
// Does NOT require Docker/K8s access.

export {
  getContestInfo,
  activateContest,
  freezeScoreboard,
  finalizeContest,
  updateContestScores
} from "./contest";

export {
  getAssessmentInfo,
  activateAssessment,
  closeAssessment
} from "./assessment";

export { runPlagiarismCheck } from "./plagiarism";

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
