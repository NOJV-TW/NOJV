import { browser } from "$app/environment";

import { fetchWithCsrf } from "$lib/services/http";

export interface NotificationItem {
  id: string;
  type: string;
  params: Record<string, unknown>;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

interface SseNotificationEvent {
  id?: string;
  notificationType: string;
  params: unknown;
  linkUrl: string | null;
  createdAt?: string;
}

class NotificationsStore {
  items = $state<NotificationItem[]>([]);
  unreadCount = $state(0);
  isAnimating = $state(false);

  private shakeResetTimer: ReturnType<typeof setTimeout> | null = null;

  async init() {
    if (!browser) return;
    const res = await fetch("/api/notifications?limit=20");
    if (!res.ok) return;
    const data = (await res.json()) as { items: NotificationItem[]; unreadCount: number };
    this.items = data.items;
    this.unreadCount = data.unreadCount;
  }

  handleSseEvent(payload: SseNotificationEvent) {
    if (!payload.id || !payload.createdAt) {
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

    this.items[idx] = { ...original, readAt: new Date().toISOString() };
    this.unreadCount = Math.max(0, this.unreadCount - 1);

    const res = await fetchWithCsrf(`/api/notifications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ read: true }),
    });
    if (!res.ok) {
      this.items[idx] = original;
      this.unreadCount += 1;
    }
  }

  async markAll() {
    const originalCount = this.unreadCount;
    const originalItems = this.items;
    const now = new Date().toISOString();

    this.items = this.items.map((i) => (i.readAt ? i : { ...i, readAt: now }));
    this.unreadCount = 0;

    const res = await fetchWithCsrf("/api/notifications", {
      method: "PATCH",
      body: JSON.stringify({ action: "markAllRead" }),
    });
    if (!res.ok) {
      this.items = originalItems;
      this.unreadCount = originalCount;
    }
  }
}

export const notifications = new NotificationsStore();
