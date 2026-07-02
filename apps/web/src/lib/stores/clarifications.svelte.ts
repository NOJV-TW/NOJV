import { browser } from "$app/environment";
import type { ClarificationSSEEvent } from "@nojv/core";

import { fetchWithCsrf } from "$lib/services/http";

export interface ClarificationItem {
  id: string;
  contextType: "contest" | "exam" | "assignment";
  contextId: string;
  problemId: string | null;
  questionText: string;
  answerText: string | null;
  state: "pending" | "answered" | "dismissed";
  askedBy: { id: string; username: string; name: string } | null;
  answeredBy: { id: string; username: string; name: string } | null;
  answeredAt: string | null;
  createdAt: string;
  isPublic: boolean;
  isMine: boolean;
}

export interface ClarificationsStore {
  readonly items: ClarificationItem[];
  readonly unreadCount: number;
  init(): Promise<void>;
  handleSse(event: ClarificationSSEEvent): void;
  ask(questionText: string, problemId: string | null): Promise<void>;
  answer(id: string, answerText: string, isPublic: boolean): Promise<void>;
  dismiss(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  canned(id: string, templateKey: "noComment" | "readProblem" | "yes" | "no"): Promise<void>;
  markTabVisited(): void;
}

async function answer(id: string, answerText: string, isPublic: boolean): Promise<void> {
  const r = await fetchWithCsrf(`/api/clarifications/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ answerText, isPublic }),
  });
  if (!r.ok) throw new Error("Answer failed");
}

async function dismiss(id: string): Promise<void> {
  const r = await fetchWithCsrf(`/api/clarifications/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "dismissed" }),
  });
  if (!r.ok) throw new Error("Dismiss failed");
}

async function canned(
  id: string,
  templateKey: "noComment" | "readProblem" | "yes" | "no",
): Promise<void> {
  const r = await fetchWithCsrf(`/api/clarifications/${id}/replies`, {
    method: "POST",
    body: JSON.stringify({ templateKey }),
  });
  if (!r.ok) throw new Error("Canned reply failed");
}

export function createClarificationsStore(
  contextType: "contest" | "exam" | "assignment",
  contextId: string,
): ClarificationsStore {
  let items = $state<ClarificationItem[]>([]);
  let lastSeenAt = $state<string | null>(null);

  const storageKey = `clarifications-lastSeen-${contextType}-${contextId}`;
  if (browser) {
    lastSeenAt = localStorage.getItem(storageKey);
  }

  async function init(): Promise<void> {
    if (!browser) return;
    const params = new URLSearchParams({ type: contextType });
    if (contextType === "assignment") params.set("assignmentId", contextId);
    if (contextType === "exam") params.set("examId", contextId);
    if (contextType === "contest") params.set("contestId", contextId);
    const r = await fetch(`/api/clarifications?${params.toString()}`);
    if (!r.ok) return;
    const data = (await r.json()) as { items: ClarificationItem[] };
    items = data.items;
  }

  function handleSse(event: ClarificationSSEEvent): void {
    if (event.payload.contextType !== contextType || event.payload.contextId !== contextId) {
      return;
    }
    const payload = event.payload;
    if (event.action === "deleted") {
      items = items.filter((i) => i.id !== payload.id);
      return;
    }
    const idx = items.findIndex((i) => i.id === payload.id);
    // Broadcast clarifications are always public; keep any existing "mine" flag
    // (the SSE payload is viewer-agnostic and cannot know it).
    const incoming = {
      ...payload,
      isPublic: true,
      isMine: idx >= 0 ? (items[idx]?.isMine ?? false) : false,
    } as ClarificationItem;
    if (idx >= 0) {
      items[idx] = incoming;
    } else {
      items = [...items, incoming];
    }
  }

  function buildAskContext() {
    if (contextType === "assignment") return { type: contextType, assignmentId: contextId };
    if (contextType === "exam") return { type: contextType, examId: contextId };
    return { type: contextType, contestId: contextId };
  }

  async function ask(questionText: string, problemId: string | null): Promise<void> {
    const context = buildAskContext();
    const r = await fetchWithCsrf("/api/clarifications", {
      method: "POST",
      body: JSON.stringify({ context, problemId, questionText }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({ message: "Ask failed" }))) as {
        message?: string;
      };
      throw new Error(body.message ?? "Ask failed");
    }
    // New questions are not broadcast to peers, so add ours from the response.
    const created = (await r.json().catch(() => null)) as ClarificationItem | null;
    if (created && !items.some((i) => i.id === created.id)) {
      items = [...items, created];
    }
  }

  async function remove(id: string): Promise<void> {
    const r = await fetchWithCsrf(`/api/clarifications/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error("Delete failed");
    items = items.filter((i) => i.id !== id);
  }

  function markTabVisited(): void {
    const now = new Date().toISOString();
    lastSeenAt = now;
    if (browser) localStorage.setItem(storageKey, now);
  }

  const unreadCount = $derived.by(() => {
    const seen = lastSeenAt;
    if (!seen) return items.length;
    return items.filter((i) => i.createdAt > seen).length;
  });

  return {
    get items() {
      return items;
    },
    get unreadCount() {
      return unreadCount;
    },
    init,
    handleSse,
    ask,
    answer,
    dismiss,
    delete: remove,
    canned,
    markTabVisited,
  };
}
