import { buildDraftKey, type DraftKey } from "./code-draft";

export interface DraftSnapshot extends DraftKey {
  code: string;
}

export function createDraftAutosaveQueue(
  delayMs: number,
  persist: (snapshot: DraftSnapshot) => void,
) {
  const pending = new Map<
    string,
    { snapshot: DraftSnapshot; timer: ReturnType<typeof setTimeout> }
  >();

  function keyOf(snapshot: DraftSnapshot): string {
    return buildDraftKey(snapshot);
  }

  function cancel(snapshot: DraftSnapshot): void {
    const key = keyOf(snapshot);
    const existing = pending.get(key);
    if (!existing) return;
    clearTimeout(existing.timer);
    pending.delete(key);
  }

  function schedule(snapshot: DraftSnapshot): void {
    cancel(snapshot);
    const key = keyOf(snapshot);
    const captured = structuredClone(snapshot);
    const timer = setTimeout(() => {
      pending.delete(key);
      persist(captured);
    }, delayMs);
    pending.set(key, { snapshot: captured, timer });
  }

  function has(snapshot: DraftSnapshot): boolean {
    return pending.has(keyOf(snapshot));
  }

  function flushAll(): void {
    const snapshots = [...pending.values()].map(({ snapshot }) => snapshot);
    for (const { timer } of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const snapshot of snapshots) persist(snapshot);
  }

  return { cancel, flushAll, has, schedule };
}
