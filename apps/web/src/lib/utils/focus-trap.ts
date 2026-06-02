const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function trapFocus(node: HTMLElement) {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  function focusables(): HTMLElement[] {
    return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null,
    );
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const items = focusables();
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const initial = focusables()[0];
  initial?.focus();

  node.addEventListener("keydown", onKeydown);
  return {
    destroy() {
      node.removeEventListener("keydown", onKeydown);
      previouslyFocused?.focus();
    },
  };
}
