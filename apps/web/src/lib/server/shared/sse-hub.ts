import type Redis from "ioredis";
import { createSubscriber } from "@nojv/redis";

import { createLogger } from "../logger";

export type SseMessageHandler = (channel: string, message: string) => void;

const logger = createLogger("sse-hub");

let subscriber: Redis | null = null;
const channelHandlers = new Map<string, Set<SseMessageHandler>>();

function ensureSubscriber(redisUrl: string): Redis {
  if (subscriber) return subscriber;
  const client = createSubscriber(redisUrl);
  client.on("message", (channel: string, message: string) => {
    const handlers = channelHandlers.get(channel);
    if (!handlers) return;
    for (const handler of handlers) handler(channel, message);
  });
  subscriber = client;
  return client;
}

export function subscribeSse(
  redisUrl: string,
  channels: string[],
  handler: SseMessageHandler,
): () => void {
  const client = ensureSubscriber(redisUrl);

  const newChannels: string[] = [];
  for (const channel of channels) {
    let handlers = channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      channelHandlers.set(channel, handlers);
      newChannels.push(channel);
    }
    handlers.add(handler);
  }
  if (newChannels.length > 0) {
    void client.subscribe(...newChannels).catch((err: unknown) => {
      logger.error("Redis SSE subscribe failed", {
        channels: newChannels,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return () => {
    const idleChannels: string[] = [];
    for (const channel of channels) {
      const handlers = channelHandlers.get(channel);
      if (!handlers) continue;
      handlers.delete(handler);
      if (handlers.size === 0) {
        channelHandlers.delete(channel);
        idleChannels.push(channel);
      }
    }
    if (idleChannels.length > 0 && subscriber) {
      void subscriber.unsubscribe(...idleChannels).catch((err: unknown) => {
        logger.warn("Redis SSE unsubscribe failed", {
          channels: idleChannels,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
  };
}
