import { writable } from "svelte/store";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  duration?: number;
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  return {
    subscribe,
    add(toast: Omit<Toast, "id">) {
      const id = crypto.randomUUID();
      update((toasts) => [...toasts, { ...toast, id }]);
      setTimeout(() => {
        update((toasts) => toasts.filter((t) => t.id !== id));
      }, toast.duration ?? 5000);
    },
    remove(id: string) {
      update((toasts) => toasts.filter((t) => t.id !== id));
    }
  };
}

export const toasts = createToastStore();
