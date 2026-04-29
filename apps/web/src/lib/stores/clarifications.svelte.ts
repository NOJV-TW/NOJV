import { browser } from "$app/environment";
import type { ClarificationSSEEvent } from "@nojv/core";

export interface ClarificationItem {
  id: string;
  contextType: "contest" | "exam" | "assignment";
  contextId: string;
  problemId: string | null;
  questionText: string;
  answerText: string | null;
  state: "pending" | "answered" | "dismissed";
  /**
   * `null` for non-staff viewers (anonymity projection). Staff of the
   * context see the real asker. See `canSeeAuthor` in the domain module.
   */
  askedBy: { id: string; username: string; name: string } | null;
  answeredBy: { id: string; username: string; name: string } | null;
  answeredAt: string | null;
  createdAt: string;
}

export interface ClarificationsStore {
  readonly items: ClarificationItem[];
  readonly unreadCount: number;
  init(): Promise<void>;
  handleSse(event: ClarificationSSEEvent): void;
  ask(questionText: string, problemId: string | null): Promise<void>;
  answer(id: string, answerText: string): Promise<void>;
  dismiss(id: string): Promise<void>;
  canned(id: string, templateKey: "noComment" | "readProblem" | "yes" | "no"): Promise<void>;
  markTabVisited(): void;
}

/**
 * One store per (contextType, contextId). The caller creates it in
 * `ClarificationTab` on mount and discards it on destroy — state does
 * not survive navigation, which matches the scoped nature of the board.
 *
 * The "last seen" timestamp is persisted to `localStorage` under a key
 * that includes the context so switching between two live contests
 * keeps separate unread counts.
 */
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
    const params = new URLSearchParams({ contextType, contextId });
    const r = await fetch(`/api/clarifications?${params.toString()}`);
    if (!r.ok) return;
    const data = (await r.json()) as { items: ClarificationItem[] };
    items = data.items;
  }

  function handleSse(event: ClarificationSSEEvent): void {
    // Only apply events for our context — the SSE subscription is already
    // scoped, but defensive filtering keeps multiple-tab races safe.
    if (event.payload.contextType !== contextType || event.payload.contextId !== contextId) {
      return;
    }
    const incoming = event.payload as ClarificationItem;
    const idx = items.findIndex((i) => i.id === incoming.id);
    if (idx >= 0) {
      items[idx] = incoming;
    } else {
      items = [...items, incoming];
    }
  }

  async function ask(questionText: string, problemId: string | null): Promise<void> {
    const r = await fetch("/api/clarifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ contextType, contextId, problemId, questionText }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({ message: "Ask failed" }))) as {
        message?: string;
      };
      throw new Error(body.message ?? "Ask failed");
    }
    // SSE push will populate the list; don't optimistically insert.
  }

  async function answer(id: string, answerText: string): Promise<void> {
    const r = await fetch(`/api/clarifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ answerText }),
    });
    if (!r.ok) throw new Error("Answer failed");
  }

  async function dismiss(id: string): Promise<void> {
    const r = await fetch(`/api/clarifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ state: "dismissed" }),
    });
    if (!r.ok) throw new Error("Dismiss failed");
  }

  async function canned(
    id: string,
    templateKey: "noComment" | "readProblem" | "yes" | "no",
  ): Promise<void> {
    const r = await fetch(`/api/clarifications/${id}/canned`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ templateKey }),
    });
    if (!r.ok) throw new Error("Canned reply failed");
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
    canned,
    markTabVisited,
  };
}
