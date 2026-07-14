import { z } from "zod";
import type { SubmissionContext } from "@nojv/core";

export type DraftContext =
  | { kind: "practice" }
  | { kind: "exam"; examId: string }
  | { kind: "assignment"; assignmentId: string }
  | { kind: "contest"; contestId: string }
  | { kind: "virtual"; participationId: string };

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
      return `assignment:${context.assignmentId}`;
    case "contest":
      return `contest:${context.contestId}`;
    case "virtual":
      return `virtual:${context.participationId}`;
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

export function draftContextFromSubmissionContext(context: SubmissionContext): DraftContext {
  switch (context.type) {
    case "practice":
      return { kind: "practice" };
    case "exam":
      return { kind: "exam", examId: context.examId };
    case "assignment":
      return { kind: "assignment", assignmentId: context.assessmentId };
    case "contest":
      return { kind: "contest", contestId: context.contestId };
    case "virtual":
      return { kind: "virtual", participationId: context.participationId };
  }
}
