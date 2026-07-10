import { proxyActivities, sleep } from "@temporalio/workflow";
import type { ContestLifecycleInput } from "@nojv/core";
import type * as lifecycleActivities from "../activities/lifecycle";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";
import { computeReminderCheckpoints } from "./reminder-checkpoints";

const contest = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof lifecycleActivities>(NOTIFICATION_ACTIVITY);

export async function contestLifecycleWorkflow(input: ContestLifecycleInput): Promise<void> {
  const contestInfo = await contest.getContestInfo(input.contestId);
  const endsAt = new Date(contestInfo.endsAt).getTime();

  const startsAtMs = new Date(contestInfo.startsAt).getTime();
  for (const cp of computeReminderCheckpoints(startsAtMs, 0, Date.now())) {
    const ms = cp.atMs - Date.now();
    if (ms > 0) await sleep(ms);
    await contest.fanoutContestStartingSoon(input.contestId, cp.leadDays);
  }

  const msUntilStart = startsAtMs - Date.now();
  if (msUntilStart > 0) {
    await sleep(msUntilStart);
  }

  await contest.activateContest(input.contestId);
  await notification.publishContestEvent(input.contestId, "starting");

  if (contestInfo.freezeTime) {
    const msUntilFreeze = new Date(contestInfo.freezeTime).getTime() - Date.now();
    if (msUntilFreeze > 0) {
      await sleep(msUntilFreeze);
      await contest.freezeScoreboard(input.contestId);
    }
  }

  const msUntilEnd = endsAt - Date.now();
  if (msUntilEnd > 0) {
    await sleep(msUntilEnd);
  }

  await contest.finalizeContest(input.contestId);
  await notification.publishContestEvent(input.contestId, "ending");
}
