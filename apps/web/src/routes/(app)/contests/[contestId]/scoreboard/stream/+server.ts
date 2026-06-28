import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { keys } from "@nojv/redis";
import { contestDomain } from "@nojv/application";
import { createSseResponse } from "$lib/server/shared/sse-response";
import { apiRateLimiter } from "$lib/server/shared/rate-limiter";
import { z } from "zod";

const sseEnvSchema = z.object({
  REDIS_URL: z.url(),
});

export const GET: RequestHandler = async (event) => {
  const actor = getActorContext(event);
  if (!actor || !hasActorUsername(actor)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const envResult = sseEnvSchema.safeParse(process.env);
  if (!envResult.success) {
    return new Response("SSE not configured", { status: 503 });
  }

  const userId = actor.userId;
  try {
    await apiRateLimiter.consume(`u:${userId}`);
  } catch {
    return new Response("Too many requests", { status: 429 });
  }

  const { contestId } = event.params;
  const redisUrl = envResult.data.REDIS_URL;

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
    redisUrl,
    request: event.request,
  });
};
