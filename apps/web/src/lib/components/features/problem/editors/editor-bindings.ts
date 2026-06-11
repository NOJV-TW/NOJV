import { entryFileNameFor, type Language, type ProblemType } from "@nojv/core";
import type { ProblemDetail } from "$lib/types";
import type {
  SubmissionAssessmentContext,
  SubmissionRequest,
  SubmissionWorkspaceFile,
} from "$lib/services/submission-service";

export const EDITOR_LANGUAGE_COOKIE = "nojv_editor_lang";
const PANEL_WIDTH_STORAGE_KEY = "nojv:editor:panelWidth";

export const DEFAULT_PANEL_WIDTH = 42;
export const MIN_PANEL_WIDTH = 20;
export const MAX_PANEL_WIDTH = 80;

export function clampPanelWidth(width: number): number {
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width));
}

export function readPanelWidth(): number {
  try {
    const raw = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (raw === null) return DEFAULT_PANEL_WIDTH;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return clampPanelWidth(parsed);
  } catch {
    // localStorage may throw under private-mode quotas / SSR; fall through.
  }
  return DEFAULT_PANEL_WIDTH;
}

export function persistPanelWidth(width: number): void {
  try {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(clampPanelWidth(width)));
  } catch {
    // Quota / disabled storage — silently no-op.
  }
}

export type WorkspaceFile = ProblemDetail["workspaceFiles"][number];

export function workspaceDraftKey(lang: string, path: string): string {
  return `${lang}::${path}`;
}

export function persistLanguage(lang: Language): void {
  try {
    document.cookie = `${EDITOR_LANGUAGE_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Disabled cookies / SSR — silently no-op.
  }
}

export function pickInitialWorkspaceIndex(files: WorkspaceFile[], language: Language): number {
  const entry = entryFileNameFor(language);
  const entryIndex = files.findIndex((f) => f.path === entry && f.visibility === "editable");
  if (entryIndex >= 0) return entryIndex;
  const firstEditable = files.findIndex((f) => f.visibility === "editable");
  return Math.max(firstEditable, 0);
}

export function seedWorkspaceDrafts(files: WorkspaceFile[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const f of files) {
    drafts[workspaceDraftKey(f.language, f.path)] = f.content;
  }
  return drafts;
}

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

export function projectRunCasesForRequest(
  cases: { input: string; expectedOutput: string }[],
): { input: string; expectedOutput?: string }[] {
  return cases.map((tc) => {
    const mapped: { input: string; expectedOutput?: string } = { input: tc.input };
    if (tc.expectedOutput !== "") mapped.expectedOutput = tc.expectedOutput;
    return mapped;
  });
}

export function isWorkspaceProblem(type: ProblemType): boolean {
  return type === "multi_file";
}

export function isSpecialEnvProblem(type: ProblemType): boolean {
  return type === "special_env";
}

export function bindEscapeToExitFullscreen(onExit: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onExit();
  };
  globalThis.addEventListener("keydown", onKey);
  return () => globalThis.removeEventListener("keydown", onKey);
}

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

export function buildSubmissionRequest(args: {
  problemId: string;
  language: Language;
  isWorkspaceMode: boolean;
  drafts: Record<string, string>;
  workspaceFiles: WorkspaceFile[];
  workspaceDrafts: Record<string, string>;
  sampleOnly: boolean;
  runCases?: { input: string; expectedOutput?: string }[] | undefined;
  assessment?: SubmissionAssessmentContext | undefined;
  contestId?: string | undefined;
  participationId?: string | undefined;
}): SubmissionRequest {
  const base: Omit<SubmissionRequest, "sourceCode" | "sourceFiles"> = {
    language: args.language,
    problemId: args.problemId,
    sampleOnly: args.sampleOnly,
    ...(args.assessment ? { assessment: args.assessment } : {}),
    ...(args.contestId ? { contestId: args.contestId } : {}),
    ...(args.participationId ? { participationId: args.participationId } : {}),
    ...(args.runCases ? { runCases: args.runCases } : {}),
  };
  if (args.isWorkspaceMode) {
    const files = projectWorkspaceFilesForSubmit(args.workspaceFiles, args.workspaceDrafts);
    const firstEditable =
      args.workspaceFiles.find((f) => f.visibility === "editable") ?? args.workspaceFiles[0];
    const sourceCode = firstEditable
      ? (files.find((c) => c.path === firstEditable.path)?.content ?? "")
      : "";
    return { ...base, sourceCode, sourceFiles: files };
  }
  return { ...base, sourceCode: args.drafts[args.language] ?? "" };
}

export function projectSubmittedSource(args: {
  language: Language;
  isWorkspaceMode: boolean;
  drafts: Record<string, string>;
  workspaceFiles: WorkspaceFile[];
  workspaceDrafts: Record<string, string>;
}): string {
  if (!args.isWorkspaceMode) return args.drafts[args.language] ?? "";
  return projectWorkspaceFilesForSubmit(args.workspaceFiles, args.workspaceDrafts)
    .map((f) => `// --- ${f.path} ---\n${f.content}`)
    .join("\n\n");
}
