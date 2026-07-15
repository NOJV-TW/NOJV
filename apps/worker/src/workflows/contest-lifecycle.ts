import { proxyActivities, sleep } from "@temporalio/workflow";
import type { ContestLifecycleInput } from "@nojv/core";
import type * as lifecycleActivities from "../activities/lifecycle";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";
import { computeReminderCheckpoints } from "./reminder-checkpoints";

const contest = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof lifecycleActivities>(NOTIFICATION_ACTIVITY);

export async function contestLifecycleWorkflow(input: ContestLifecycleInput): Promise<void> {
  const endsAt = Date.parse(input.endsAt);

  const startsAtMs = Date.parse(input.startsAt);
  for (const cp of computeReminderCheckpoints(startsAtMs, 0, Date.now())) {
    const ms = cp.atMs - Date.now();
    if (ms > 0) await sleep(ms);
    await contest.fanoutContestStartingSoon(input, cp.leadDays);
  }

  const msUntilStart = startsAtMs - Date.now();
  if (msUntilStart > 0) {
    await sleep(msUntilStart);
  }

  if (!(await contest.activateContest(input))) return;
  await notification.publishContestEvent(input.contestId, "starting");

  if (input.scoreboardMode === "frozen" && input.frozenAt) {
    const msUntilFreeze = Date.parse(input.frozenAt) - Date.now();
    if (msUntilFreeze > 0) {
      await sleep(msUntilFreeze);
    }
    if (!(await contest.freezeScoreboard(input))) return;
  }

  const msUntilEnd = endsAt - Date.now();
  if (msUntilEnd > 0) {
    await sleep(msUntilEnd);
  }

  if (!(await contest.finalizeContest(input))) return;
  await notification.publishContestEvent(input.contestId, "ending");
}
