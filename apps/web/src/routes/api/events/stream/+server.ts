import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { keys } from "@nojv/redis";
import { clarificationDomain } from "@nojv/application";
type ClarificationContext = clarificationDomain.ClarificationContext;
import { createLogger } from "$lib/server/logger";
import { createSseResponse } from "$lib/server/shared/sse-response";
import { z } from "zod";

const CLARIFICATION_CONTEXT_TYPES = new Set(["contest", "exam", "assignment"] as const);

type ClarificationContextType = "contest" | "exam" | "assignment";

function parseClarificationSubs(url: URL): ClarificationContext[] {
  const out: ClarificationContext[] = [];
  const seen = new Set<string>();
  for (const raw of url.searchParams.getAll("clarificationSub")) {
    const idx = raw.indexOf(":");
    if (idx <= 0 || idx === raw.length - 1) continue;
    const contextType = raw.slice(0, idx);
    const contextId = raw.slice(idx + 1);
    if (!CLARIFICATION_CONTEXT_TYPES.has(contextType as ClarificationContextType)) continue;
    if (contextId.length === 0 || contextId.length > 200) continue;
    const key = `${contextType}:${contextId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    switch (contextType as ClarificationContextType) {
      case "contest":
        out.push({ type: "contest", contestId: contextId });
        break;
      case "exam":
        out.push({ type: "exam", examId: contextId });
        break;
      case "assignment":
        out.push({ type: "assignment", assignmentId: contextId });
        break;
    }
  }
  return out;
}

const logger = createLogger("sse-stream");

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
  const redisUrl = envResult.data.REDIS_URL;

  const authorizedClarChannels: string[] = [];
  try {
    const requestedSubs = parseClarificationSubs(event.url);
    for (const sub of requestedSubs) {
      const [canAsk, canAnswer] = await Promise.all([
        clarificationDomain.canAskClarification(actor, sub),
        clarificationDomain.canAnswerInContext(actor, sub),
      ]);
      if (canAsk || canAnswer) {
        const { contextType, contextId } = clarificationDomain.toContextDbFields(sub);
        authorizedClarChannels.push(keys.clarificationChannel(contextType, contextId));
        if (canAnswer) {
          authorizedClarChannels.push(keys.clarificationStaffChannel(contextType, contextId));
        }
      }
    }
  } catch (err) {
    logger.warn("SSE clarification authorization failed", { userId, err });
    return new Response("Internal error", { status: 500 });
  }

  return createSseResponse({
    channels: [
      keys.userChannel(userId),
      keys.notificationChannel(userId),
      ...authorizedClarChannels,
    ],
    slotType: "events",
    userId,
    redisUrl,
    request: event.request,
  });
};
