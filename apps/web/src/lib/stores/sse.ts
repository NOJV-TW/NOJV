import { browser } from "$app/environment";
import {
  SSE_NOTIFICATION,
  SSE_SUBMISSION_VERDICT,
  sseEventSchema,
  type SSEEvent,
} from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";
import { formatVerdictLabel } from "$lib/utils/verdict-style";
import { notifications } from "./notifications.svelte";
import { toasts } from "./toast";

let eventSource: EventSource | null = null;
const listeners = new Map<string, Set<(data: SSEEvent) => void>>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let recoveryListenersRegistered = false;

const clarificationSubs = new Set<string>();

function registerRecoveryListeners(): void {
  if (!browser || recoveryListenersRegistered) return;
  recoveryListenersRegistered = true;
  const kick = () => {
    if (eventSource) return;
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connectSSE();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });
}

function buildStreamUrl(): string {
  if (clarificationSubs.size === 0) return "/api/events/stream";
  const params = new URLSearchParams();
  for (const sub of clarificationSubs) {
    params.append("clarificationSub", sub);
  }
  return `/api/events/stream?${params.toString()}`;
}

export function connectSSE() {
  if (!browser || eventSource) return;
  registerRecoveryListeners();

  eventSource = new EventSource(buildStreamUrl());

  eventSource.onopen = () => {
    reconnectAttempts = 0;
  };

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
      return;
    }
  };

  eventSource.onerror = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    eventSource?.close();
    eventSource = null;
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

function reconnectIfConnected(): void {
  if (!browser) return;
  if (!eventSource) return;
  eventSource.close();
  eventSource = null;
  connectSSE();
}

export function subscribeClarificationChannel(
  contextType: "contest" | "exam" | "assignment",
  contextId: string,
): void {
  if (!browser) return;
  const key = `${contextType}:${contextId}`;
  if (clarificationSubs.has(key)) return;
  clarificationSubs.add(key);
  reconnectIfConnected();
}

export function unsubscribeClarificationChannel(
  contextType: "contest" | "exam" | "assignment",
  contextId: string,
): void {
  if (!browser) return;
  const key = `${contextType}:${contextId}`;
  if (!clarificationSubs.has(key)) return;
  clarificationSubs.delete(key);
  reconnectIfConnected();
}

function handleDefaultEvent(data: SSEEvent) {
  if (data.type === SSE_NOTIFICATION) {
    notifications.handleSseEvent({
      notificationType: data.notificationType,
      params: data.params,
      linkUrl: data.linkUrl,
      ...(data.id !== undefined && { id: data.id }),
      ...(data.createdAt !== undefined && { createdAt: data.createdAt }),
    });
    return;
  }

  if (data.type === SSE_SUBMISSION_VERDICT) {
    if (browser && data.problemId && window.location.pathname.includes(data.problemId)) {
      return;
    }
    if (data.verdict === "accepted") {
      toasts.success(m.sse_verdictToastAccepted());
    } else {
      toasts.info(m.sse_verdictToastResult({ verdict: formatVerdictLabel(data.verdict) }));
    }
  }
}
