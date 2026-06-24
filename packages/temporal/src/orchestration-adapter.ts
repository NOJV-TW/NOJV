import { getTemporalClient } from "./client";
import {
  cancelRejudge,
  dispatchAssignmentDueSoon,
  dispatchContestLifecycle,
  dispatchExamAutoClose,
  dispatchPlagiarismCheck,
  dispatchRejudge,
  dispatchSubmissionJudge,
  queryRejudgeProgress,
  terminateSubmissionJudge,
} from "./dispatch";

export function buildDomainOrchestrationAdapter() {
  return {
    cancelRejudge,
    dispatchAssignmentDueSoon,
    dispatchContestLifecycle,
    dispatchExamAutoClose,
    dispatchPlagiarismCheck,
    dispatchRejudge,
    dispatchSubmissionJudge,
    async probeTemporal() {
      const client = await getTemporalClient();
      await client.connection.workflowService.getSystemInfo({});
    },
    queryRejudgeProgress,
    terminateSubmissionJudge,
  };
}
