import { browser } from "$app/environment";
import { toasts } from "./toast";

let eventSource: EventSource | null = null;
const listeners = new Map<string, Set<(data: Record<string, unknown>) => void>>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectSSE() {
  if (!browser || eventSource) return;

  eventSource = new EventSource("/api/events/stream");

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as Record<string, unknown>;
      const type = data.type as string;

      // Notify specific listeners
      const typeListeners = listeners.get(type);
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
    reconnectTimer = setTimeout(connectSSE, 5000);
  };
}

export function disconnectSSE() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  eventSource?.close();
  eventSource = null;
}

export function onSSEEvent(
  type: string,
  callback: (data: Record<string, unknown>) => void
): () => void {
  if (!listeners.has(type)) {
    listeners.set(type, new Set());
  }
  listeners.get(type)!.add(callback);

  // Return unsubscribe function
  return () => {
    listeners.get(type)?.delete(callback);
  };
}

function handleDefaultEvent(data: Record<string, unknown>) {
  if (data.type === "contest:starting") {
    toasts.add({ message: "Contest starting soon!", type: "info" });
  }
  if (data.type === "contest:ending") {
    toasts.add({ message: "Contest ending soon!", type: "info" });
  }
  if (data.type === "assignment:deadline") {
    toasts.add({ message: "Assignment deadline approaching!", type: "info" });
  }
}
