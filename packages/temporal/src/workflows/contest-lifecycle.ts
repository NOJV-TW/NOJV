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

const contest = proxyActivities<typeof contestActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 }
});

const notification = proxyActivities<typeof notificationActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 }
});

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

  // 1. Wait until contest starts
  const msUntilStart = new Date(contestInfo.startsAt).getTime() - Date.now();
  if (msUntilStart > 0) {
    await sleep(msUntilStart);
  }

  // 2. Activate contest
  await contest.activateContest(input.contestId);
  await notification.publishContestEvent(input.contestId, "starting");

  // 3. Wait for freeze time (if set)
  if (contestInfo.freezeTime) {
    const msUntilFreeze = new Date(contestInfo.freezeTime).getTime() - Date.now();
    if (msUntilFreeze > 0) {
      const shouldContinue = await condition(() => earlyEnd, msUntilFreeze);
      if (!shouldContinue && !earlyEnd) {
        await contest.freezeScoreboard(input.contestId);
      }
    }
  }

  // 4. Wait until contest ends (or early end signal)
  if (!earlyEnd) {
    const msUntilEnd = endsAt - Date.now();
    if (msUntilEnd > 0) {
      await condition(() => earlyEnd, msUntilEnd);
    }
  }

  // 5. Finalize
  await contest.finalizeContest(input.contestId);
  await notification.publishContestEvent(input.contestId, "ending");
}
