import { m } from "$lib/paraglide/messages.js";
import {
  buildDraftKey,
  clearDraft,
  loadDraft,
  saveDraft,
  type DraftContext,
} from "$lib/stores/code-draft";
import { createDraftAutosaveQueue, type DraftSnapshot } from "$lib/stores/draft-autosave";
import { toasts } from "$lib/stores/toast";
import type { ServerDraftSync } from "$lib/services/draft-sync";
import type { Language } from "@nojv/core";

interface DraftControllerArgs {
  problemId: string;
  isWorkspaceMode: () => boolean;
  draftContext: () => DraftContext;
  language: () => Language;
  currentCode: () => string;
  starterFor: (lang: Language) => string;
  applyCode: (lang: Language, code: string) => void;
  serverSync: ServerDraftSync;
}

export interface DraftController {
  readonly enabled: boolean;
  readonly isDirty: boolean;
  readonly currentLastSavedAt: number | null;
  hydrate: () => Promise<void>;
  save: () => void;
  scheduleAutosave: () => void;
  dispose: () => void;
}

const AUTOSAVE_DELAY_MS = 1200;

export function createDraftController(args: DraftControllerArgs): DraftController {
  const lastSavedCode = $state<Record<string, string>>({});
  const lastSavedAt = $state<Record<string, number | null>>({});
  const hydratedLanguages = $state<Record<string, boolean>>({});

  const currentDraftKey = $derived(
    buildDraftKey({
      context: args.draftContext(),
      problemId: args.problemId,
      language: args.language(),
    }),
  );
  const enabled = $derived(!args.isWorkspaceMode());
  const isDirty = $derived(
    enabled &&
      hydratedLanguages[currentDraftKey] === true &&
      args.currentCode() !== lastSavedCode[currentDraftKey],
  );
  const currentLastSavedAt = $derived(enabled ? (lastSavedAt[currentDraftKey] ?? null) : null);

  const hydrating = new Set<string>();

  async function hydrate() {
    const ctx = args.draftContext();
    if (args.isWorkspaceMode()) return;
    const lang = args.language();
    const draftKey = buildDraftKey({ context: ctx, problemId: args.problemId, language: lang });
    if (hydratedLanguages[draftKey] || hydrating.has(draftKey)) return;
    hydrating.add(draftKey);
    const key = { context: ctx, problemId: args.problemId, language: lang };
    const [record, serverDrafts] = await Promise.all([loadDraft(key), args.serverSync.load()]);
    hydrating.delete(draftKey);
    if (record) {
      args.applyCode(lang, record.code);
      lastSavedCode[draftKey] = record.code;
      lastSavedAt[draftKey] = record.savedAt;
      hydratedLanguages[draftKey] = true;
      syncToServer({ ...key, code: record.code });
      return;
    }
    const serverDraft = serverDrafts?.find((d) => d.language === lang && d.sourceCode !== null);
    const code = serverDraft?.sourceCode ?? args.starterFor(lang);
    args.applyCode(lang, code);
    lastSavedCode[draftKey] = code;
    lastSavedAt[draftKey] = serverDraft ? Date.parse(serverDraft.updatedAt) : null;
    hydratedLanguages[draftKey] = true;
  }

  function syncToServer(snapshot: DraftSnapshot) {
    const draftKey = buildDraftKey(snapshot);
    args.serverSync.schedule(snapshot.language, { sourceCode: snapshot.code }, () => {
      if (lastSavedCode[draftKey] === snapshot.code) clearDraft(snapshot);
    });
  }

  function currentSnapshot(): DraftSnapshot | null {
    const context = args.draftContext();
    if (args.isWorkspaceMode()) return null;
    return {
      context,
      problemId: args.problemId,
      language: args.language(),
      code: args.currentCode(),
    };
  }

  async function persist(snapshot: DraftSnapshot, notify: boolean) {
    try {
      const record = await saveDraft(snapshot, snapshot.code);
      const draftKey = buildDraftKey(snapshot);
      lastSavedCode[draftKey] = snapshot.code;
      lastSavedAt[draftKey] = record.savedAt;
      syncToServer(snapshot);
      if (notify) toasts.success(m.draft_saved());
    } catch {
      if (notify) toasts.error(m.draft_saveFailed());
    }
  }

  const autosave = createDraftAutosaveQueue(AUTOSAVE_DELAY_MS, (snapshot) => {
    void persist(snapshot, false);
  });

  function save() {
    const snapshot = currentSnapshot();
    if (!snapshot || !hydratedLanguages[currentDraftKey]) return;
    autosave.cancel(snapshot);
    void persist(snapshot, true).then(() => args.serverSync.flush());
  }

  function scheduleAutosave() {
    if (!enabled || !isDirty) return;
    const snapshot = currentSnapshot();
    if (snapshot) autosave.schedule(snapshot);
  }

  function dispose() {
    const snapshot = currentSnapshot();
    const currentWasPending = snapshot ? autosave.has(snapshot) : false;
    autosave.flushAll();
    if (snapshot && enabled && isDirty && !currentWasPending) void persist(snapshot, false);
  }

  return {
    get enabled() {
      return enabled;
    },
    get isDirty() {
      return isDirty;
    },
    get currentLastSavedAt() {
      return currentLastSavedAt;
    },
    hydrate,
    save,
    scheduleAutosave,
    dispose,
  };
}
