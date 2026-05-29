import {
  proxyActivities,
  defineSignal,
  setHandler,
  sleep,
  condition,
} from "@temporalio/workflow";
import type { ContestLifecycleInput, AdminOverrideSignal } from "@nojv/temporal";
import type * as lifecycleActivities from "../activities/lifecycle";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";

const contest = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof lifecycleActivities>(NOTIFICATION_ACTIVITY);

const START_REMINDER_MINUTES = 15;

export const adminOverrideSignal = defineSignal<[AdminOverrideSignal]>("adminOverride");

export async function contestLifecycleWorkflow(input: ContestLifecycleInput): Promise<void> {
  const contestInfo = await contest.getContestInfo(input.contestId);
  let endsAt = new Date(contestInfo.endsAt).getTime();
  let earlyEnd = false;

  setHandler(adminOverrideSignal, (signal) => {
    if (signal.action === "earlyEnd") {
      earlyEnd = true;
    } else {
      endsAt = new Date(signal.newEndsAt).getTime();
    }
  });

  const startsAtMs = new Date(contestInfo.startsAt).getTime();
  const reminderAtMs = startsAtMs - START_REMINDER_MINUTES * 60_000;
  const msUntilReminder = reminderAtMs - Date.now();
  if (msUntilReminder > 0) {
    await sleep(msUntilReminder);
  }
  await contest.fanoutContestStartingSoon(input.contestId);

  const msUntilStart = startsAtMs - Date.now();
  if (msUntilStart > 0) {
    await sleep(msUntilStart);
  }

  await contest.activateContest(input.contestId);
  await notification.publishContestEvent(input.contestId, "starting");

  if (contestInfo.freezeTime) {
    const msUntilFreeze = new Date(contestInfo.freezeTime).getTime() - Date.now();
    if (msUntilFreeze > 0) {
      const shouldContinue = await condition(() => earlyEnd, msUntilFreeze);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!shouldContinue && !earlyEnd) {
        await contest.freezeScoreboard(input.contestId);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!earlyEnd) {
    const msUntilEnd = endsAt - Date.now();
    if (msUntilEnd > 0) {
      await condition(() => earlyEnd, msUntilEnd);
    }
  }

  await contest.finalizeContest(input.contestId);
  await notification.publishContestEvent(input.contestId, "ending");
}
