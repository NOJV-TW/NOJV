import {
  proxyActivities,
  defineSignal,
  setHandler,
  sleep,
  condition,
} from "@temporalio/workflow";
import type { ContestLifecycleInput, AdminOverrideSignal } from "../types";
import type * as contestActivities from "../activities/contest";
import type * as notificationActivities from "../activities/notification";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";

const contest = proxyActivities<typeof contestActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof notificationActivities>(NOTIFICATION_ACTIVITY);
// `fanoutContestStartingSoon` persists notification rows + chunked Redis
// pub/sub; give it SHORT's 30s budget and 3 retries instead of the 10s
// pub/sub default.
const notificationDurable = proxyActivities<typeof notificationActivities>(SHORT_ACTIVITY);

const START_REMINDER_MINUTES = 15;

export const adminOverrideSignal = defineSignal<[AdminOverrideSignal]>("adminOverride");

export async function contestLifecycleWorkflow(input: ContestLifecycleInput): Promise<void> {
  const contestInfo = await contest.getContestInfo(input.contestId);
  let endsAt = new Date(contestInfo.endsAt).getTime();
  let earlyEnd = false;

  setHandler(adminOverrideSignal, (signal) => {
    if (signal.action === "earlyEnd") {
      earlyEnd = true;
    } else if (signal.action === "extend") {
      endsAt = new Date(signal.newEndsAt).getTime();
    }
  });

  // Fan out `contest_starting_soon` 15 min before the contest opens.
  // The domain helper no-ops if the contest was unpublished or the
  // start time already passed, so we don't need a second guard here.
  const startsAtMs = new Date(contestInfo.startsAt).getTime();
  const reminderAtMs = startsAtMs - START_REMINDER_MINUTES * 60_000;
  const msUntilReminder = reminderAtMs - Date.now();
  if (msUntilReminder > 0) {
    await sleep(msUntilReminder);
  }
  await notificationDurable.fanoutContestStartingSoon(input.contestId);

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
      if (!shouldContinue && !earlyEnd) {
        await contest.freezeScoreboard(input.contestId);
      }
    }
  }

  if (!earlyEnd) {
    const msUntilEnd = endsAt - Date.now();
    if (msUntilEnd > 0) {
      await condition(() => earlyEnd, msUntilEnd);
    }
  }

  await contest.finalizeContest(input.contestId);
  await notification.publishContestEvent(input.contestId, "ending");
}
