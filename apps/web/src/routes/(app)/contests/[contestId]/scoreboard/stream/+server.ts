import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { keys } from "@nojv/redis";
import { contestDomain } from "@nojv/application";
import { createSseResponse } from "$lib/server/shared/sse-response";

export const GET: RequestHandler = async (event) => {
  const actor = getActorContext(event);
  if (!actor || !hasActorUsername(actor)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = actor.userId;
  const { contestId } = event.params;

  let detail;
  try {
    detail = await contestDomain.getContestDetail(contestId, {
      now: new Date(),
      platformRole: actor.platformRole,
      userId,
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (detail.problemsHidden) {
    return new Response("Forbidden", { status: 403 });
  }

  return createSseResponse({
    channels: [keys.contestChannel(contestId)],
    slotType: "scoreboard",
    userId,
    request: event.request,
  });
};
