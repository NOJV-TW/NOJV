import { untrack } from "svelte";

export type ShortcutCategory = "navigation" | "actions" | "help";

export interface Shortcut {
  id: string;
  keys: string[] | string[][];
  description: string;
  category: ShortcutCategory;
  handler: (event: KeyboardEvent) => void;
  allowInInputs?: boolean;
}

function normalizeKey(event: KeyboardEvent): string {
  const key = (event.key as string | undefined) ?? "";
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

function comboMatches(keys: string[], event: KeyboardEvent): boolean {
  if (keys.length === 0) return false;
  const modifiers = new Set(keys.slice(0, -1).map((k) => k.toLowerCase()));
  const mainKey = keys.at(-1);
  if (!mainKey) return false;
  const normalizedMain = mainKey.length === 1 ? mainKey.toUpperCase() : mainKey;
  if (normalizeKey(event) !== normalizedMain) return false;
  const needCtrl = modifiers.has("ctrl") || modifiers.has("cmd") || modifiers.has("meta");
  const ctrlPressed = event.ctrlKey || event.metaKey;
  if (needCtrl !== ctrlPressed) return false;
  if (modifiers.has("shift") !== event.shiftKey) return false;
  if (modifiers.has("alt") !== event.altKey) return false;
  return true;
}

class ShortcutRegistry {
  shortcuts = $state<Shortcut[]>([]);
  isOverlayOpen = $state(false);
  #pendingFirstKey = $state<string | null>(null);
  #sequenceTimer: ReturnType<typeof setTimeout> | null = null;

  register(shortcut: Shortcut): () => void {
    untrack(() => {
      this.shortcuts = [...this.shortcuts, shortcut];
    });
    return () => {
      this.unregister(shortcut.id);
    };
  }

  unregister(id: string) {
    untrack(() => {
      this.shortcuts = this.shortcuts.filter((s) => s.id !== id);
    });
  }

  toggleOverlay() {
    this.isOverlayOpen = !this.isOverlayOpen;
  }

  handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const inEditable = !!(
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    );

    if (!inEditable && event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.toggleOverlay();
      return;
    }

    const keyLabel = normalizeKey(event);

    if (this.#pendingFirstKey) {
      const pending = this.#pendingFirstKey;
      const seqShortcut = this.shortcuts.find((s) => {
        if (!Array.isArray(s.keys[0])) return false;
        const seq = s.keys as string[][];
        if (seq[0]?.[0] !== pending) return false;
        if (seq[1]?.[0] !== keyLabel) return false;
        if (!s.allowInInputs && inEditable) return false;
        return true;
      });
      this.#clearPending();
      if (seqShortcut) {
        event.preventDefault();
        seqShortcut.handler(event);
        return;
      }
    }

    const comboShortcut = this.shortcuts.find((s) => {
      if (Array.isArray(s.keys[0])) return false;
      if (s.allowInInputs !== true && inEditable) return false;
      return comboMatches(s.keys as string[], event);
    });
    if (comboShortcut) {
      event.preventDefault();
      comboShortcut.handler(event);
      return;
    }

    const startsSeq = this.shortcuts.some((s) => {
      if (!Array.isArray(s.keys[0])) return false;
      const seq = s.keys as string[][];
      if (seq[0]?.[0] !== keyLabel) return false;
      if (!s.allowInInputs && inEditable) return false;
      return true;
    });
    if (startsSeq) {
      this.#pendingFirstKey = keyLabel;
      this.#sequenceTimer = setTimeout(() => {
        this.#clearPending();
      }, 1500);
    }
  }

  #clearPending() {
    this.#pendingFirstKey = null;
    if (this.#sequenceTimer) {
      clearTimeout(this.#sequenceTimer);
      this.#sequenceTimer = null;
    }
  }
}

export const shortcuts = new ShortcutRegistry();

export function useGlobalShortcuts() {
  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      shortcuts.handleKeydown(e);
    };
    globalThis.addEventListener("keydown", handler);
    return () => {
      globalThis.removeEventListener("keydown", handler);
    };
  });
}
