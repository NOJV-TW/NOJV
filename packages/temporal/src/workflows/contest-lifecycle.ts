import {
  proxyActivities,
  defineSignal,
  setHandler,
  sleep,
  condition
} from "@temporalio/workflow";
import type { ContestLifecycleInput, AdminOverrideSignal } from "../types";
import type * as contestActivities from "../activities/contest";
import type * as notificationActivities from "../activities/notification";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";

const contest = proxyActivities<typeof contestActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof notificationActivities>(NOTIFICATION_ACTIVITY);

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

  const msUntilStart = new Date(contestInfo.startsAt).getTime() - Date.now();
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
