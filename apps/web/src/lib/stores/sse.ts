import { browser } from "$app/environment";
import {
  SSE_CONTEST_STARTING,
  SSE_CONTEST_ENDING,
  SSE_ASSIGNMENT_DEADLINE,
  sseEventSchema,
  type SSEEvent
} from "@nojv/core";
import { toasts } from "./toast";

let eventSource: EventSource | null = null;
const listeners = new Map<string, Set<(data: SSEEvent) => void>>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export function connectSSE() {
  if (!browser || eventSource) return;

  eventSource = new EventSource("/api/events/stream");

  eventSource.onmessage = (event) => {
    try {
      reconnectAttempts = 0;
      const parsed = sseEventSchema.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) return;

      const data = parsed.data;

      // Notify specific listeners
      const typeListeners = listeners.get(data.type);
      if (typeListeners) {
        for (const listener of typeListeners) {
          listener(data);
        }
      }

      // Default toast for unhandled events
      if (!typeListeners?.size) {
        handleDefaultEvent(data);
      }
    } catch {
      // Ignore malformed messages
    }
  };

  eventSource.onerror = () => {
    disconnectSSE();
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    const delay = Math.min(5000 * 2 ** reconnectAttempts, 60_000);
    reconnectAttempts++;
    reconnectTimer = setTimeout(connectSSE, delay);
  };
}

export function disconnectSSE() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  eventSource?.close();
  eventSource = null;
}

export function onSSEEvent(type: string, callback: (data: SSEEvent) => void): () => void {
  if (!listeners.has(type)) {
    listeners.set(type, new Set());
  }
  listeners.get(type)?.add(callback);

  // Return unsubscribe function
  return () => {
    listeners.get(type)?.delete(callback);
  };
}

function handleDefaultEvent(data: SSEEvent) {
  if (data.type === SSE_CONTEST_STARTING) {
    toasts.add({ message: "Contest starting soon!", type: "info" });
  }
  if (data.type === SSE_CONTEST_ENDING) {
    toasts.add({ message: "Contest ending soon!", type: "info" });
  }
  if (data.type === SSE_ASSIGNMENT_DEADLINE) {
    toasts.add({ message: "Assignment deadline approaching!", type: "info" });
  }
}
