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
  const key = event.key;
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

function comboMatches(keys: string[], event: KeyboardEvent): boolean {
  if (keys.length === 0) return false;
  const modifiers = new Set(keys.slice(0, -1).map((k) => k.toLowerCase()));
  const mainKey = keys[keys.length - 1];
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
  // $state.raw so only whole-array reassignment triggers reactivity;
  // individual item reads are not tracked. Combined with the untrack
  // wrappers below, this makes register/unregister side-effect-free from
  // the caller effect's tracking perspective.
  shortcuts = $state.raw<Shortcut[]>([]);
  isOverlayOpen = $state(false);
  #pendingFirstKey: string | null = null;
  #sequenceTimer: ReturnType<typeof setTimeout> | null = null;

  register(shortcut: Shortcut): () => void {
    // Read + write via untrack so callers running inside an $effect don't
    // track `this.shortcuts` as a dep, which would cause register()'s
    // write to retrigger the calling effect → infinite loop.
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

    // Built-in: "?" opens overlay (only outside editables)
    if (!inEditable && event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.toggleOverlay();
      return;
    }

    const keyLabel = normalizeKey(event);

    // If we have a pending first key, try sequence match
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

    // Try single combo
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

    // Start a new sequence if the pressed key is the first key of any registered sequence
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

/**
 * Helper hook for the root layout to install the global keydown listener.
 * Call inside a Svelte component's top-level script (requires runes context).
 */
export function useGlobalShortcuts() {
  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      shortcuts.handleKeydown(e);
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  });
}
