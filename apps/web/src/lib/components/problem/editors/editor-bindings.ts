/**
 * Pure helpers extracted from `apps/web/src/lib/components/problem/Editor.svelte`.
 *
 * Each function here is framework-agnostic (no Svelte runes) so the editor
 * shell can stay focused on rune-bound state. Tests can exercise these
 * helpers directly without instantiating a Svelte component.
 */
import { entryFileNameFor, languageSchema, type Language, type ProblemType } from "@nojv/core";
import type { ProblemDetail } from "$lib/types";
import type { SubmissionWorkspaceFile } from "$lib/services/submission-service";

const LANGUAGE_STORAGE_KEY = "nojv:editor:language";

export type WorkspaceFile = ProblemDetail["workspaceFiles"][number];

/** Compose the per-language draft-map key for workspace mode. */
export function workspaceDraftKey(lang: string, path: string): string {
  return `${lang}::${path}`;
}

/**
 * Read the persisted preferred language from localStorage, falling back to
 * "cpp". The schema parse keeps the fallback safe if a future build changes
 * the supported language set.
 */
export function readPersistedLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const parsed = languageSchema.safeParse(saved);
    if (parsed.success) return parsed.data;
  } catch {
    // localStorage may throw under private-mode quotas / SSR; fall through.
  }
  return "cpp";
}

/** Persist the active language so the next visit boots into the same one. */
export function persistLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Quota / disabled storage — silently no-op.
  }
}

/**
 * Pick the workspace file the student should land on for a language. Prefer
 * the canonical `main.<ext>` entry; fall back to the first editable file;
 * finally fall back to index 0.
 */
export function pickInitialWorkspaceIndex(files: WorkspaceFile[], language: Language): number {
  const entry = entryFileNameFor(language);
  const entryIndex = files.findIndex((f) => f.path === entry && f.visibility === "editable");
  if (entryIndex >= 0) return entryIndex;
  const firstEditable = files.findIndex((f) => f.visibility === "editable");
  return firstEditable >= 0 ? firstEditable : 0;
}

/** Seed a per-language/per-path draft map from the server's workspace files. */
export function seedWorkspaceDrafts(files: WorkspaceFile[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const f of files) {
    drafts[workspaceDraftKey(f.language, f.path)] = f.content;
  }
  return drafts;
}

/**
 * Project the workspace-file array into the wire shape the worker expects:
 * hidden files are stripped, editable files carry the student's draft,
 * read-only files carry the original content.
 */
export function projectWorkspaceFilesForSubmit(
  files: WorkspaceFile[],
  drafts: Record<string, string>,
): SubmissionWorkspaceFile[] {
  return files
    .filter((f) => f.visibility !== "hidden")
    .map((f) => ({
      path: f.path,
      content:
        f.visibility === "editable"
          ? (drafts[workspaceDraftKey(f.language, f.path)] ?? f.content)
          : f.content,
    }));
}

/**
 * For the "Run" flow, transform the editable sample-cases array into the
 * worker-side shape. `expectedOutput: ""` means "don't compare, just echo
 * stdout"; we drop the field entirely so the worker treats it as undefined.
 */
export function projectRunCasesForRequest(
  cases: { input: string; expectedOutput: string }[],
): { input: string; expectedOutput?: string }[] {
  return cases.map((tc) => {
    const mapped: { input: string; expectedOutput?: string } = { input: tc.input };
    if (tc.expectedOutput !== "") mapped.expectedOutput = tc.expectedOutput;
    return mapped;
  });
}

/** Workspace-mode = student-editable multi-file (not special_env / not single-file). */
export function isWorkspaceProblem(type: ProblemType): boolean {
  return type === "multi_file";
}

/** Special-env problems skip student-owned sample cases entirely. */
export function isSpecialEnvProblem(type: ProblemType): boolean {
  return type === "special_env";
}

/**
 * Bind an Escape-key listener to exit fullscreen. Returns the cleanup fn
 * so the caller can wire it into a Svelte `$effect`.
 */
export function bindEscapeToExitFullscreen(onExit: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onExit();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/**
 * Wire up a vertical drag handle that resizes a panel measured against the
 * given container. Returns a `(MouseEvent) => void` to attach to onmousedown.
 *
 * `onHeightChange` is the only side-effect — the caller owns the actual
 * height state. `onResizingChange` lets the UI flip a "active drag" affordance.
 */
export function createBottomResizeHandler({
  getContainer,
  onHeightChange,
  onResizingChange,
  minHeight = 120,
  maxRatio = 0.8,
}: {
  getContainer: () => HTMLElement | null;
  onHeightChange: (next: number) => void;
  onResizingChange: (active: boolean) => void;
  minHeight?: number;
  maxRatio?: number;
}): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    e.preventDefault();
    const container = getContainer();
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const next = rect.bottom - ev.clientY;
      onHeightChange(Math.max(minHeight, Math.min(rect.height * maxRatio, next)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizingChange(false);
    };

    onResizingChange(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
}
