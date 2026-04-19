import { browser } from "$app/environment";
import {
  SSE_CONTEST_STARTING,
  SSE_CONTEST_ENDING,
  SSE_ASSIGNMENT_DEADLINE,
  SSE_NOTIFICATION,
  sseEventSchema,
  type SSEEvent
} from "@nojv/core";
import { notifications } from "./notifications.svelte";
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

      const typeListeners = listeners.get(data.type);
      if (typeListeners) {
        for (const listener of typeListeners) {
          listener(data);
        }
      }

      if (!typeListeners?.size) {
        handleDefaultEvent(data);
      }
    } catch {
      // swallow malformed messages
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

  return () => {
    listeners.get(type)?.delete(callback);
  };
}

// Clarification channel subscription plumbing — implemented in Task 11.
// Stubbed here so components can import without the type system
// noticing. The functions are no-ops until Task 11 wires them into the
// EventSource URL.
export function subscribeClarificationChannel(
  _contextType: "contest" | "exam" | "assignment",
  _contextId: string
): void {
  // no-op stub
}

export function unsubscribeClarificationChannel(
  _contextType: "contest" | "exam" | "assignment",
  _contextId: string
): void {
  // no-op stub
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
  if (data.type === SSE_NOTIFICATION) {
    // Batch signals arrive without id/createdAt; the store falls back to
    // refetching /api/notifications/recent in that case.
    notifications.handleSseEvent({
      notificationType: data.notificationType,
      params: data.params,
      linkUrl: data.linkUrl,
      ...(data.id !== undefined && { id: data.id }),
      ...(data.createdAt !== undefined && { createdAt: data.createdAt })
    });
  }
}
