import { submissionHistory } from "./submission/history";
import { submissionIdentity } from "./submission/identity";
import { submissionLifecycle } from "./submission/lifecycle";
import { submissionStatistics } from "./submission/statistics";

export type {
  SubmissionCreateContext,
  SubmissionHistoryBoundary,
  SubmissionHistoryFilters,
} from "./submission/shared";

export const submissionRepo = {
  ...submissionIdentity,
  ...submissionHistory,
  ...submissionStatistics,
  ...submissionLifecycle,
};
