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
  resetSelectionForLanguage: () => void;
  applyChange: (value: string) => void;
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
