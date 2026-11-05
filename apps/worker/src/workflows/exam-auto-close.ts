import { patched, proxyActivities, sleep } from "@temporalio/workflow";
import type { ExamAutoCloseInput } from "@nojv/core";
import type * as lifecycleActivities from "../activities/lifecycle";
import { SHORT_ACTIVITY } from "./activity-options";
import { computeAutoCloseDelayMs } from "./exam-auto-close-helpers";
import { computeReminderCheckpoints } from "./reminder-checkpoints";

const lifecycle = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);
const { triggerClosedExamReport } = proxyActivities<typeof lifecycleActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumInterval: "5m" },
});

export async function examAutoCloseWorkflow(input: ExamAutoCloseInput): Promise<void> {
  const startsAtMs = Date.parse(input.startsAt);
  for (const cp of computeReminderCheckpoints(startsAtMs, 0, Date.now())) {
    const ms = cp.atMs - Date.now();
    if (ms > 0) await sleep(ms);
    await lifecycle.fanoutExamStartingSoon(input, cp.leadDays);
  }

  const delayMs = computeAutoCloseDelayMs(input.endsAt);
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  await lifecycle.closeActiveSessionsForExam(input);
  if (patched("exam-close-plagiarism-v1")) {
    while ((await triggerClosedExamReport(input)) === "wait") {
      await sleep("30s");
    }
  }
}
