import { getTemporalClient } from "./client";
import {
  cancelAssignmentDueSoon,
  cancelContestLifecycle,
  cancelExamAutoClose,
  describeSubmissionJudge,
  dispatchJudgeExecution,
  dispatchJudgeCleanup,
  dispatchPlagiarismCheck,
  dispatchRegistryGarbageCollect,
  ensureAssignmentDueSoon,
  ensureContestLifecycle,
  ensureExamAutoClose,
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
    describeSubmissionJudge,
    dispatchJudgeExecution,
    dispatchJudgeCleanup,
    dispatchPlagiarismCheck,
    dispatchRegistryGarbageCollect,
    ensureAssignmentDueSoon,
    ensureContestLifecycle,
    ensureExamAutoClose,
    async probeTemporal() {
      const client = await getTemporalClient();
      await client.connection.workflowService.getSystemInfo({});
    },
    replaceAssignmentDueSoon,
    replaceContestLifecycle,
    replaceExamAutoClose,
    terminateSubmissionJudge,
  };
}
