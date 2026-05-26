/**
 * Stateful draft controller used by `Editor.svelte`. Owns per-language
 * hydration / save / clear / dirty-tracking so the editor shell can stay
 * thin. Workspace-mode problems are out of scope here — they have no
 * single-blob draft.
 */
import { m } from "$lib/paraglide/messages.js";
import { clearDraft, loadDraft, saveDraft, type DraftContext } from "$lib/stores/code-draft";
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
  clear: () => void;
  registerShortcut: () => (() => void) | undefined;
}

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

  function save() {
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
      toasts.add({ type: "success", message: m.draft_saved() });
    } catch {
      toasts.add({ type: "error", message: m.draft_saveFailed() });
    }
  }

  function clear() {
    const ctx = args.draftContext();
    if (args.isWorkspaceMode() || !ctx) return;
    if (typeof window === "undefined") return;
    if (!window.confirm(m.draft_clearConfirm())) return;
    const lang = args.language();
    clearDraft({ context: ctx, problemId: args.problemId, language: lang });
    const starter = args.starterFor(lang);
    args.applyCode(lang, starter);
    lastSavedCode[lang] = starter;
    lastSavedAt[lang] = null;
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
    clear,
    registerShortcut,
  };
}
