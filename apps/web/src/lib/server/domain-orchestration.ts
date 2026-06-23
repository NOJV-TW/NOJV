import { configureDomainOrchestration } from "@nojv/application";
import {
  cancelRejudge,
  dispatchAssignmentDueSoon,
  dispatchContestLifecycle,
  dispatchExamAutoClose,
  dispatchPlagiarismCheck,
  dispatchRejudge,
  dispatchSubmissionJudge,
  getTemporalClient,
  queryRejudgeProgress,
  terminateSubmissionJudge,
} from "@nojv/temporal";

configureDomainOrchestration({
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
});
