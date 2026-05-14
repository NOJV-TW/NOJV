/**
 * Stateful workspace-mode controller used by `Editor.svelte`. Owns
 * per-language file selection + per-file draft maps. Returns a thin reactive
 * surface so the editor shell can stay focused on the run/submit flow.
 */
import { type Language } from "@nojv/core";
import {
  pickInitialWorkspaceIndex,
  seedWorkspaceDrafts,
  workspaceDraftKey,
  type WorkspaceFile,
} from "./editor-bindings";

interface WorkspaceFilesControllerArgs {
  initialFiles: WorkspaceFile[];
  filesForLanguage: () => WorkspaceFile[];
  language: () => Language;
}

export interface WorkspaceFilesController {
  readonly drafts: Record<string, string>;
  readonly selectedIndex: number;
  readonly selectedFile: WorkspaceFile | undefined;
  readonly selectedContent: string;
  select: (index: number) => void;
  /** Called on language change to land on the canonical `main.<ext>` file. */
  resetSelectionForLanguage: () => void;
  /** Update the currently-selected editable file's draft. */
  applyChange: (value: string) => void;
  /** Reset all editable files for the current language to their server content. */
  resetCurrentLanguage: () => void;
}

export function createWorkspaceFilesController(
  args: WorkspaceFilesControllerArgs,
): WorkspaceFilesController {
  const drafts = $state<Record<string, string>>(seedWorkspaceDrafts(args.initialFiles));
  let selectedIndex = $state(0);

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
    },
    resetCurrentLanguage() {
      const lang = args.language();
      for (const f of args.initialFiles) {
        if (f.language !== lang || f.visibility !== "editable") continue;
        drafts[workspaceDraftKey(f.language, f.path)] = f.content;
      }
    },
  };
}
