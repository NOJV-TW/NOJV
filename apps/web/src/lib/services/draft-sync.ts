import type { Language, SubmissionContext } from "@nojv/core";

import { fetchWithCsrf } from "$lib/services/http";

export interface DraftSourceFile {
  path: string;
  content: string;
}

export type DraftSource = { sourceCode: string } | { sourceFiles: DraftSourceFile[] };

export interface ServerDraft {
  language: Language;
  sourceCode: string | null;
  sourceFiles: DraftSourceFile[] | null;
  updatedAt: string;
}

export interface ServerDraftSync {
  load: () => Promise<ServerDraft[] | null>;
  schedule: (language: string, source: DraftSource, onSaved: () => void) => void;
  flush: () => void;
  dispose: () => void;
}

export const DRAFT_SYNC_INTERVAL_MS = 5000;
const KEEPALIVE_BODY_LIMIT = 60_000;

interface PendingSave {
  source: DraftSource;
  onSaved: () => void;
}

export function createServerDraftSync(
  context: SubmissionContext,
  problemId: string,
): ServerDraftSync {
  let loaded: Promise<ServerDraft[] | null> | null = null;
  let available = false;
  const pending = new Map<string, PendingSave>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function load() {
    loaded ??= fetch(
      `/api/drafts?${new URLSearchParams({ context: JSON.stringify(context), problemId })}`,
    )
      .then(async (response) => {
        if (!response.ok) return null;
        available = true;
        return ((await response.json()) as { drafts: ServerDraft[] }).drafts;
      })
      .catch(() => null);
    return loaded;
  }

  function arm() {
    timer ??= setTimeout(() => {
      timer = null;
      flushWith(false);
    }, DRAFT_SYNC_INTERVAL_MS);
  }

  async function send(language: string, save: PendingSave, keepalive: boolean) {
    const body = JSON.stringify({ context, problemId, language, ...save.source });
    try {
      const response = await fetchWithCsrf("/api/drafts", {
        method: "PUT",
        body,
        keepalive: keepalive && body.length <= KEEPALIVE_BODY_LIMIT,
      });
      if (response.ok) {
        save.onSaved();
        return;
      }
      if (response.status < 500 && response.status !== 429) return;
    } catch {
      if (keepalive) return;
    }
    if (!pending.has(language)) pending.set(language, save);
    arm();
  }

  function flushWith(keepalive: boolean) {
    if (timer) clearTimeout(timer);
    timer = null;
    const batch = [...pending];
    pending.clear();
    for (const [language, save] of batch) void send(language, save, keepalive);
  }

  function onHidden() {
    if (document.visibilityState === "hidden") flushWith(true);
  }
  const onPageHide = () => flushWith(true);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
  }

  return {
    load,
    schedule(language, source, onSaved) {
      if (!available) return;
      pending.set(language, { source, onSaved });
      arm();
    },
    flush: () => flushWith(false),
    dispose() {
      flushWith(true);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("pagehide", onPageHide);
      }
    },
  };
}
