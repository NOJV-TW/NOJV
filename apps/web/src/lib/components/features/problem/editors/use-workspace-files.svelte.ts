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
import type { ServerDraftSync } from "$lib/services/draft-sync";

interface WorkspaceFilesControllerArgs {
  problemId: string;
  initialFiles: WorkspaceFile[];
  filesForLanguage: () => WorkspaceFile[];
  language: () => Language;
  draftContext: () => DraftContext;
  serverSync: ServerDraftSync;
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

  const locallySaved = new Map<string, string>();

  function editableFiles(language: string) {
    return args.initialFiles.filter(
      (f) => f.language === language && f.visibility === "editable",
    );
  }

  function syncLanguage(language: string) {
    const files = editableFiles(language).map((f) => ({
      path: f.path,
      content: drafts[workspaceDraftKey(f.language, f.path)] ?? f.content,
    }));
    args.serverSync.schedule(language, { sourceFiles: files }, () => {
      for (const [index, file] of editableFiles(language).entries()) {
        const key = storageKey(file);
        if (locallySaved.get(key) !== files[index]?.content) continue;
        locallySaved.delete(key);
        localStorage.removeItem(key);
      }
    });
  }

  async function adoptLegacy(file: WorkspaceFile, draftKey: string): Promise<boolean> {
    if (args.draftContext().kind === "exam") return false;
    const legacyKey = legacyStorageKey(file);
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null || drafts[draftKey] !== file.content) return false;
    drafts[draftKey] = legacy;
    await persist(file, legacy);
    if (locallySaved.has(storageKey(file))) localStorage.removeItem(legacyKey);
    return true;
  }

  async function hydrateDrafts() {
    if (typeof localStorage === "undefined") return;
    const serverDrafts = await args.serverSync.load();
    const unsynced = new Set<string>();
    for (const file of args.initialFiles) {
      if (file.visibility !== "editable") continue;
      const key = storageKey(file);
      const draftKey = workspaceDraftKey(file.language, file.path);
      try {
        const record = await openDraft(args.draftContext(), key, localStorage.getItem(key));
        if (record) {
          locallySaved.set(key, record.code);
          unsynced.add(file.language);
          if (drafts[draftKey] === file.content) drafts[draftKey] = record.code;
        } else if (await adoptLegacy(file, draftKey)) {
          unsynced.add(file.language);
        } else {
          const server = serverDrafts
            ?.find((d) => d.language === file.language)
            ?.sourceFiles?.find((f) => f.path === file.path);
          if (server && drafts[draftKey] === file.content) drafts[draftKey] = server.content;
        }
      } catch {
        return;
      }
    }
    for (const language of unsynced) syncLanguage(language);
  }

  void hydrateDrafts();

  async function persist(file: WorkspaceFile, value: string) {
    const key = storageKey(file);
    try {
      const { serialized } = await sealDraft(args.draftContext(), key, value);
      if (drafts[workspaceDraftKey(file.language, file.path)] !== value) return;
      localStorage.setItem(key, serialized);
      locallySaved.set(key, value);
    } catch {
      return;
    }
    syncLanguage(file.language);
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
      drafts[workspaceDraftKey(file.language, file.path)] = value;
      void persist(file, value);
    },
    resetCurrentLanguage() {
      const lang = args.language();
      for (const f of args.initialFiles) {
        if (f.language !== lang || f.visibility !== "editable") continue;
        drafts[workspaceDraftKey(f.language, f.path)] = f.content;
        locallySaved.delete(storageKey(f));
        try {
          localStorage.removeItem(storageKey(f));
        } catch {
          return;
        }
      }
      syncLanguage(lang);
    },
  };
}
