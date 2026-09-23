import { type Language } from "@nojv/core";
import {
  buildDraftKey,
  legacyDraftKey,
  openDraft,
  sealDraft,
  type DraftContext,
} from "$lib/stores/code-draft";
import {
  pickInitialWorkspaceIndex,
  seedWorkspaceDrafts,
  workspaceDraftKey,
  type WorkspaceFile,
} from "./editor-bindings";

interface WorkspaceFilesControllerArgs {
  problemId: string;
  initialFiles: WorkspaceFile[];
  filesForLanguage: () => WorkspaceFile[];
  language: () => Language;
  draftContext: () => DraftContext;
}

export interface WorkspaceFilesController {
  readonly drafts: Record<string, string>;
  readonly selectedIndex: number;
  readonly selectedFile: WorkspaceFile | undefined;
  readonly selectedContent: string;
  select: (index: number) => void;
  resetSelectionForLanguage: () => void;
  applyChange: (value: string) => void;
  resetCurrentLanguage: () => void;
}

export function createWorkspaceFilesController(
  args: WorkspaceFilesControllerArgs,
): WorkspaceFilesController {
  const drafts = $state<Record<string, string>>(seedWorkspaceDrafts(args.initialFiles));
  let selectedIndex = $state(0);

  function storageKey(file: WorkspaceFile): string {
    return `${buildDraftKey({ context: args.draftContext(), problemId: args.problemId, language: file.language })}:workspace:${encodeURIComponent(file.path)}`;
  }

  function legacyStorageKey(file: WorkspaceFile): string {
    return `${legacyDraftKey({ context: args.draftContext(), problemId: args.problemId, language: file.language })}:workspace:${encodeURIComponent(file.path)}`;
  }

  async function adoptLegacy(file: WorkspaceFile, draftKey: string) {
    if (args.draftContext().kind === "exam") return;
    const legacyKey = legacyStorageKey(file);
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null || drafts[draftKey] !== file.content) return;
    drafts[draftKey] = legacy;
    const key = storageKey(file);
    await persist(key, draftKey, legacy);
    if (localStorage.getItem(key) !== null) localStorage.removeItem(legacyKey);
  }

  async function hydrateDrafts() {
    if (typeof localStorage === "undefined") return;
    for (const file of args.initialFiles) {
      if (file.visibility !== "editable") continue;
      const key = storageKey(file);
      const draftKey = workspaceDraftKey(file.language, file.path);
      try {
        const record = await openDraft(args.draftContext(), key, localStorage.getItem(key));
        if (!record) await adoptLegacy(file, draftKey);
        else if (drafts[draftKey] === file.content) drafts[draftKey] = record.code;
      } catch {
        return;
      }
    }
  }

  void hydrateDrafts();

  async function persist(key: string, draftKey: string, value: string) {
    try {
      const { serialized } = await sealDraft(args.draftContext(), key, value);
      if (drafts[draftKey] === value) localStorage.setItem(key, serialized);
    } catch {
      return;
    }
  }

  const selectedFile = $derived<WorkspaceFile | undefined>(
    args.filesForLanguage()[selectedIndex],
  );
  const selectedContent = $derived(
    selectedFile
      ? (drafts[workspaceDraftKey(selectedFile.language, selectedFile.path)] ??
          selectedFile.content)
      : "",
  );

  return {
    get drafts() {
      return drafts;
    },
    get selectedIndex() {
      return selectedIndex;
    },
    get selectedFile() {
      return selectedFile;
    },
    get selectedContent() {
      return selectedContent;
    },
    select(index) {
      selectedIndex = index;
    },
    resetSelectionForLanguage() {
      selectedIndex = pickInitialWorkspaceIndex(args.filesForLanguage(), args.language());
    },
    applyChange(value) {
      const file = selectedFile;
      if (file?.visibility !== "editable") return;
      const draftKey = workspaceDraftKey(file.language, file.path);
      const key = storageKey(file);
      drafts[draftKey] = value;
      void persist(key, draftKey, value);
    },
    resetCurrentLanguage() {
      const lang = args.language();
      for (const f of args.initialFiles) {
        if (f.language !== lang || f.visibility !== "editable") continue;
        drafts[workspaceDraftKey(f.language, f.path)] = f.content;
        try {
          localStorage.removeItem(storageKey(f));
        } catch {
          return;
        }
      }
    },
  };
}
