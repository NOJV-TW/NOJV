import { z } from "zod";

export type DraftContext =
  | { kind: "practice" }
  | { kind: "exam"; examId: string }
  | { kind: "assignment"; assessmentId: string }
  | { kind: "contest"; contestId: string };

export interface DraftKey {
  context: DraftContext;
  problemId: string;
  language: string;
}

export interface DraftRecord {
  code: string;
  savedAt: number;
}

const KEY_PREFIX = "nojv:draft:v1:";

const draftRecordSchema = z.object({
  code: z.string(),
  savedAt: z.number(),
});

function contextSegment(context: DraftContext): string {
  switch (context.kind) {
    case "practice":
      return "practice";
    case "exam":
      return `exam:${context.examId}`;
    case "assignment":
      return `assignment:${context.assessmentId}`;
    case "contest":
      return `contest:${context.contestId}`;
  }
}

export function buildDraftKey(key: DraftKey): string {
  return `${KEY_PREFIX}${contextSegment(key.context)}:${key.problemId}:${key.language}`;
}

function parseDraftRecord(raw: string | null): DraftRecord | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = draftRecordSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function loadDraft(key: DraftKey): DraftRecord | null {
  return parseDraftRecord(localStorage.getItem(buildDraftKey(key)));
}

// QuotaExceededError can be a DOMException with name "QuotaExceededError" or
// the legacy code 22 (or 1014 in Firefox). Some test environments (jsdom)
// expose DOMException as a non-Error host object, so we duck-type instead of
// gating on `instanceof Error`.
function isQuotaExceeded(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown };
  if (e.name === "QuotaExceededError") return true;
  return e.code === 22 || e.code === 1014;
}

interface IndexedDraft {
  storageKey: string;
  savedAt: number;
}

function listDraftsByAge(): IndexedDraft[] {
  const entries: IndexedDraft[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (!storageKey?.startsWith(KEY_PREFIX)) continue;
    // Malformed entries are oldest-first candidates — treat them as savedAt 0.
    const record = parseDraftRecord(localStorage.getItem(storageKey));
    entries.push({ storageKey, savedAt: record?.savedAt ?? 0 });
  }
  entries.sort((a, b) => a.savedAt - b.savedAt);
  return entries;
}

export function saveDraft(key: DraftKey, code: string): DraftRecord {
  const storageKey = buildDraftKey(key);
  const record: DraftRecord = { code, savedAt: Date.now() };
  const serialized = JSON.stringify(record);

  try {
    localStorage.setItem(storageKey, serialized);
    return record;
  } catch (err) {
    if (!isQuotaExceeded(err)) throw err;
  }

  const victims = listDraftsByAge().filter((v) => v.storageKey !== storageKey);
  for (const victim of victims) {
    localStorage.removeItem(victim.storageKey);
    try {
      localStorage.setItem(storageKey, serialized);
      return record;
    } catch (err) {
      if (!isQuotaExceeded(err)) throw err;
    }
  }

  throw new Error("Draft storage quota exceeded and no more drafts to evict");
}

export function clearDraft(key: DraftKey): void {
  localStorage.removeItem(buildDraftKey(key));
}

const ROUTE_PATTERNS: {
  prefix: string;
  build: (params: Record<string, string | undefined>) => DraftContext | null;
}[] = [
  {
    prefix: "/(app)/exams/[examId]/problems/[problemId]",
    build: (params) => (params.examId ? { kind: "exam", examId: params.examId } : null),
  },
  {
    prefix: "/(app)/assignments/[assignmentId]/problems/[problemId]",
    build: (params) =>
      params.assignmentId ? { kind: "assignment", assessmentId: params.assignmentId } : null,
  },
  {
    prefix: "/(app)/contests/[contestId]/problems/[problemId]",
    build: (params) =>
      params.contestId ? { kind: "contest", contestId: params.contestId } : null,
  },
  {
    prefix: "/(app)/problems/[problemId]",
    build: () => ({ kind: "practice" }),
  },
];

export function inferDraftContext(
  routeId: string | null | undefined,
  params: Record<string, string | undefined>,
): DraftContext {
  if (!routeId) return { kind: "practice" };
  for (const pattern of ROUTE_PATTERNS) {
    if (routeId.startsWith(pattern.prefix)) {
      return pattern.build(params) ?? { kind: "practice" };
    }
  }
  return { kind: "practice" };
}
