import { writable } from "svelte/store";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  duration?: number;
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);
  // Track per-toast auto-dismiss timers so manual `remove()` can cancel them
  // and we don't run no-op `update` callbacks after a toast is already gone.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearTimer(id: string) {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }

  function remove(id: string) {
    clearTimer(id);
    update((toasts) => toasts.filter((t) => t.id !== id));
  }

  return {
    subscribe,
    add(toast: Omit<Toast, "id">) {
      const id = crypto.randomUUID();
      update((toasts) => [...toasts, { ...toast, id }]);
      const timer = setTimeout(() => {
        timers.delete(id);
        update((toasts) => toasts.filter((t) => t.id !== id));
      }, toast.duration ?? 5000);
      timers.set(id, timer);
    },
    remove
  };
}

export const toasts = createToastStore();
