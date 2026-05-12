import { browser } from "$app/environment";

import { fetchWithCsrf } from "$lib/http";

export interface NotificationItem {
  id: string;
  type: string;
  params: Record<string, unknown>;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

interface SseNotificationPayload {
  id?: string; // present for single-event pushes; absent for batch signals
  notificationType: string;
  params: unknown;
  linkUrl: string | null;
  createdAt?: string; // present for single-event; absent for batch signals
}

class NotificationsStore {
  items = $state<NotificationItem[]>([]);
  unreadCount = $state(0);
  isAnimating = $state(false);

  private shakeResetTimer: ReturnType<typeof setTimeout> | null = null;

  async init() {
    if (!browser) return;
    const res = await fetch("/api/notifications/recent?limit=20");
    if (!res.ok) return;
    const data = (await res.json()) as { items: NotificationItem[]; unreadCount: number };
    this.items = data.items;
    this.unreadCount = data.unreadCount;
  }

  // Called by the SSE client when a "notification" event arrives.
  // Batch signals (no id) trigger a re-fetch; single events prepend directly.
  handleSseEvent(payload: SseNotificationPayload) {
    if (!payload.id || !payload.createdAt) {
      // Batch signal — refetch to get the authoritative recent list
      void this.init();
      return;
    }
    this.items = [
      {
        id: payload.id,
        type: payload.notificationType,
        params: (payload.params ?? {}) as Record<string, unknown>,
        linkUrl: payload.linkUrl,
        readAt: null,
        createdAt: payload.createdAt,
      },
      ...this.items,
    ].slice(0, 20);
    this.unreadCount += 1;
    this.triggerShake();
  }

  private triggerShake() {
    this.isAnimating = true;
    if (this.shakeResetTimer) clearTimeout(this.shakeResetTimer);
    this.shakeResetTimer = setTimeout(() => {
      this.isAnimating = false;
      this.shakeResetTimer = null;
    }, 500);
  }

  async markOne(id: string) {
    const idx = this.items.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const original = this.items[idx];
    if (!original || original.readAt) return;

    // Optimistic update
    this.items[idx] = { ...original, readAt: new Date().toISOString() };
    this.unreadCount = Math.max(0, this.unreadCount - 1);

    const res = await fetchWithCsrf(`/api/notifications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ read: true }),
    });
    if (!res.ok) {
      // Rollback on server failure
      this.items[idx] = original;
      this.unreadCount += 1;
    }
  }

  async markAll() {
    const originalCount = this.unreadCount;
    const originalItems = this.items;
    const now = new Date().toISOString();

    // Optimistic: flip every unread row to readAt=now
    this.items = this.items.map((i) => (i.readAt ? i : { ...i, readAt: now }));
    this.unreadCount = 0;

    const res = await fetchWithCsrf("/api/notifications", {
      method: "PATCH",
      body: JSON.stringify({ action: "read-all" }),
    });
    if (!res.ok) {
      this.items = originalItems;
      this.unreadCount = originalCount;
    }
  }
}

export const notifications = new NotificationsStore();
