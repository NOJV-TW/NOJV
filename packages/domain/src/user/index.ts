export { ensureUser, type EnsureUserInput } from "./mutations";
export { updateUserStats } from "./stats";
export {
  listUsersPaginated,
  updateUserRole,
  toggleUserDisabled,
  getDashboardView,
  type UserAnalytics,
  type DashboardView
} from "./queries";
export { aggregateByTag } from "./analytics-helpers";
export type { TagAcCount } from "./analytics-helpers";
export {
  initiateSchoolVerification,
  processSchoolVerification,
  type InitiateVerificationResult,
  type VerifySchoolResult
} from "./verification";
