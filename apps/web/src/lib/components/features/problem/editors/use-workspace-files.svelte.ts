import { type Language } from "@nojv/core";
import { buildDraftKey, type DraftContext } from "$lib/stores/code-draft";
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

  function hydrateDrafts() {
    if (typeof localStorage === "undefined") return;
    for (const file of args.initialFiles) {
      if (file.visibility !== "editable") continue;
      try {
        const raw = localStorage.getItem(storageKey(file));
        if (raw !== null) drafts[workspaceDraftKey(file.language, file.path)] = raw;
      } catch {
        return;
      }
    }
  }

  hydrateDrafts();

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
      drafts[workspaceDraftKey(file.language, file.path)] = value;
      try {
        localStorage.setItem(storageKey(file), value);
      } catch {
        return;
      }
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
