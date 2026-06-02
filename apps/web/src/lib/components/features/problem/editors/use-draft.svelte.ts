import { m } from "$lib/paraglide/messages.js";
import { loadDraft, saveDraft, type DraftContext } from "$lib/stores/code-draft";
import { shortcuts } from "$lib/stores/shortcuts.svelte";
import { toasts } from "$lib/stores/toast";
import type { Language } from "@nojv/core";

interface DraftControllerArgs {
  problemId: string;
  isWorkspaceMode: () => boolean;
  draftContext: () => DraftContext | undefined;
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

  const enabled = $derived(!args.isWorkspaceMode() && args.draftContext() !== undefined);
  const isDirty = $derived(
    enabled && args.currentCode() !== (lastSavedCode[args.language()] ?? ""),
  );
  const currentLastSavedAt = $derived(enabled ? (lastSavedAt[args.language()] ?? null) : null);

  function hydrate() {
    const ctx = args.draftContext();
    if (args.isWorkspaceMode() || !ctx) return;
    const lang = args.language();
    if (hydratedLanguages[lang]) return;
    const record = loadDraft({ context: ctx, problemId: args.problemId, language: lang });
    if (record) {
      args.applyCode(lang, record.code);
      lastSavedCode[lang] = record.code;
      lastSavedAt[lang] = record.savedAt;
    } else {
      const starter = args.starterFor(lang);
      args.applyCode(lang, starter);
      lastSavedCode[lang] = starter;
      lastSavedAt[lang] = null;
    }
    hydratedLanguages[lang] = true;
  }

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  function persist(notify: boolean) {
    const ctx = args.draftContext();
    if (args.isWorkspaceMode() || !ctx) return;
    const lang = args.language();
    const code = args.currentCode();
    try {
      const record = saveDraft(
        { context: ctx, problemId: args.problemId, language: lang },
        code,
      );
      lastSavedCode[lang] = code;
      lastSavedAt[lang] = record.savedAt;
      if (notify) toasts.add({ type: "success", message: m.draft_saved() });
    } catch {
      if (notify) toasts.add({ type: "error", message: m.draft_saveFailed() });
    }
  }

  function save() {
    persist(true);
  }

  function scheduleAutosave() {
    if (!enabled || !isDirty) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      persist(false);
    }, AUTOSAVE_DELAY_MS);
  }

  function dispose() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (enabled && isDirty) persist(false);
  }

  function registerShortcut() {
    if (args.isWorkspaceMode() || !args.draftContext()) return undefined;
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
