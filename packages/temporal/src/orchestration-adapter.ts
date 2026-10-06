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
  dispatchTestJudgeProgramBuild,
  ensureAssignmentDueSoon,
  ensureContestLifecycle,
  ensureExamAutoClose,
  replaceAssignmentDueSoon,
  replaceContestLifecycle,
  replaceExamAutoClose,
  runTestJudgeWorkflow,
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
    dispatchTestJudgeProgramBuild,
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
    runTestJudge: runTestJudgeWorkflow,
    terminateSubmissionJudge,
  };
}
