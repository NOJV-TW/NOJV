import { m } from "$lib/paraglide/messages.js";
import { buildDraftKey, loadDraft, saveDraft, type DraftContext } from "$lib/stores/code-draft";
import { createDraftAutosaveQueue, type DraftSnapshot } from "$lib/stores/draft-autosave";
import { shortcuts } from "$lib/stores/shortcuts.svelte";
import { toasts } from "$lib/stores/toast";
import type { Language } from "@nojv/core";

interface DraftControllerArgs {
  problemId: string;
  isWorkspaceMode: () => boolean;
  draftContext: () => DraftContext;
  language: () => Language;
  currentCode: () => string;
  starterFor: (lang: Language) => string;
  applyCode: (lang: Language, code: string) => void;
}

export interface DraftController {
  readonly enabled: boolean;
  readonly isDirty: boolean;
  readonly currentLastSavedAt: number | null;
  hydrate: () => void;
  save: () => void;
  scheduleAutosave: () => void;
  dispose: () => void;
  registerShortcut: () => (() => void) | undefined;
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
    enabled && args.currentCode() !== (lastSavedCode[currentDraftKey] ?? ""),
  );
  const currentLastSavedAt = $derived(enabled ? (lastSavedAt[currentDraftKey] ?? null) : null);

  function hydrate() {
    const ctx = args.draftContext();
    if (args.isWorkspaceMode()) return;
    const lang = args.language();
    const draftKey = buildDraftKey({ context: ctx, problemId: args.problemId, language: lang });
    if (hydratedLanguages[draftKey]) return;
    const record = loadDraft({ context: ctx, problemId: args.problemId, language: lang });
    if (record) {
      args.applyCode(lang, record.code);
      lastSavedCode[draftKey] = record.code;
      lastSavedAt[draftKey] = record.savedAt;
    } else {
      const starter = args.starterFor(lang);
      args.applyCode(lang, starter);
      lastSavedCode[draftKey] = starter;
      lastSavedAt[draftKey] = null;
    }
    hydratedLanguages[draftKey] = true;
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

  function persist(snapshot: DraftSnapshot, notify: boolean) {
    try {
      const record = saveDraft(snapshot, snapshot.code);
      const draftKey = buildDraftKey(snapshot);
      lastSavedCode[draftKey] = snapshot.code;
      lastSavedAt[draftKey] = record.savedAt;
      if (notify) toasts.success(m.draft_saved());
    } catch {
      if (notify) toasts.error(m.draft_saveFailed());
    }
  }

  const autosave = createDraftAutosaveQueue(AUTOSAVE_DELAY_MS, (snapshot) =>
    persist(snapshot, false),
  );

  function save() {
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    autosave.cancel(snapshot);
    persist(snapshot, true);
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
    if (snapshot && enabled && isDirty && !currentWasPending) persist(snapshot, false);
  }

  function registerShortcut() {
    if (args.isWorkspaceMode()) return undefined;
    return shortcuts.register({
      id: `editor-save:${args.problemId}`,
      keys: ["Ctrl", "S"],
      description: m.shortcut_saveDraft(),
      category: "actions",
      allowInInputs: true,
      handler: () => save(),
    });
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
    registerShortcut,
  };
}
