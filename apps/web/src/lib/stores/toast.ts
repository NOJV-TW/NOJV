import { writable } from "svelte/store";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastUndo {
  label: string;
  onUndo: () => void | Promise<void>;
}

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
  dismissible?: boolean;
  undo?: ToastUndo;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
  dismissible: boolean;
  undo?: ToastUndo;
  timeoutId?: ReturnType<typeof setTimeout>;
}

const DEFAULT_DURATION_MS = 4000;
const MAX_TOASTS = 5;

function generateId(): string {
  return crypto.randomUUID();
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  function clearToastTimer(toast: Toast) {
    if (toast.timeoutId !== undefined) {
      clearTimeout(toast.timeoutId);
      delete toast.timeoutId;
    }
  }

  function remove(id: string) {
    update((toasts) => {
      const target = toasts.find((t) => t.id === id);
      if (target) clearToastTimer(target);
      return toasts.filter((t) => t.id !== id);
    });
  }

  function clear() {
    update((toasts) => {
      for (const t of toasts) clearToastTimer(t);
      return [];
    });
  }

  function show(message: string, options: ToastOptions = {}): string {
    const id = generateId();
    const type = options.type ?? "info";
    const duration = options.duration ?? DEFAULT_DURATION_MS;
    const dismissible = options.dismissible ?? true;

    const toast: Toast = {
      id,
      message,
      type,
      createdAt: Date.now(),
      dismissible,
      ...(options.undo ? { undo: options.undo } : {}),
    };

    update((toasts) => {
      const next = [...toasts, toast];
      while (next.length > MAX_TOASTS) {
        const dropped = next.shift();
        if (dropped) clearToastTimer(dropped);
      }
      return next;
    });

    if (duration > 0) {
      toast.timeoutId = setTimeout(() => {
        remove(id);
      }, duration);
    }

    return id;
  }

  return {
    subscribe,
    show,
    remove,
    clear,
    success: (message: string, options: Omit<ToastOptions, "type"> = {}) =>
      show(message, { ...options, type: "success" }),
    error: (message: string, options: Omit<ToastOptions, "type"> = {}) =>
      show(message, { ...options, type: "error" }),
    warning: (message: string, options: Omit<ToastOptions, "type"> = {}) =>
      show(message, { ...options, type: "warning" }),
    info: (message: string, options: Omit<ToastOptions, "type"> = {}) =>
      show(message, { ...options, type: "info" }),
  };
}

export const toasts = createToastStore();
