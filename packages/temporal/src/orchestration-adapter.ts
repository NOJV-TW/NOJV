import { getTemporalClient } from "./client";
import {
  cancelAssignmentDueSoon,
  cancelContestLifecycle,
  cancelExamAutoClose,
  cancelRejudge,
  describeSubmissionJudge,
  dispatchPlagiarismCheck,
  dispatchRegistryGarbageCollect,
  dispatchRejudge,
  dispatchSubmissionJudge,
  ensureAssignmentDueSoon,
  ensureContestLifecycle,
  ensureExamAutoClose,
  getRejudgeTriggeredBy,
  queryRejudgeProgress,
  replaceAssignmentDueSoon,
  replaceContestLifecycle,
  replaceExamAutoClose,
  terminateSubmissionJudge,
} from "./dispatch";

export function buildDomainOrchestrationAdapter() {
  return {
    cancelAssignmentDueSoon,
    cancelContestLifecycle,
    cancelExamAutoClose,
    cancelRejudge,
    describeSubmissionJudge,
    dispatchPlagiarismCheck,
    dispatchRegistryGarbageCollect,
    dispatchRejudge,
    dispatchSubmissionJudge,
    ensureAssignmentDueSoon,
    ensureContestLifecycle,
    ensureExamAutoClose,
    getRejudgeTriggeredBy,
    async probeTemporal() {
      const client = await getTemporalClient();
      await client.connection.workflowService.getSystemInfo({});
    },
    queryRejudgeProgress,
    replaceAssignmentDueSoon,
    replaceContestLifecycle,
    replaceExamAutoClose,
    terminateSubmissionJudge,
  };
}
