import { z } from "zod";
import type { SubmissionContext } from "@nojv/core";

export interface DraftOwner {
  userId: string;
  cipherKey: string;
}

export type DraftContext = DraftOwner &
  (
    | { kind: "practice" }
    | { kind: "exam"; examId: string }
    | { kind: "assignment"; assignmentId: string }
    | { kind: "contest"; contestId: string }
    | { kind: "virtual"; participationId: string }
  );

export interface DraftKey {
  context: DraftContext;
  problemId: string;
  language: string;
}

export interface DraftRecord {
  code: string;
  savedAt: number;
}

const KEY_PREFIX = "nojv:draft:v2:";

const sealedDraftSchema = z.object({
  savedAt: z.number(),
  iv: z.string(),
  data: z.string(),
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
  return `${KEY_PREFIX}${key.context.userId}:${contextSegment(key.context)}:${key.problemId}:${key.language}`;
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

function cryptoKeyFor(cipherKey: string): Promise<CryptoKey> {
  let key = importedKeys.get(cipherKey);
  if (!key) {
    key = crypto.subtle.importKey("raw", fromBase64(cipherKey), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    importedKeys.set(cipherKey, key);
  }
  return key;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function sealDraft(
  owner: DraftOwner,
  storageKey: string,
  code: string,
): Promise<{ record: DraftRecord; serialized: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(storageKey) },
    await cryptoKeyFor(owner.cipherKey),
    new TextEncoder().encode(code),
  );
  const record: DraftRecord = { code, savedAt: Date.now() };
  return {
    record,
    serialized: JSON.stringify({
      savedAt: record.savedAt,
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(data)),
    }),
  };
}

function parseSealed(raw: string | null): z.infer<typeof sealedDraftSchema> | null {
  if (raw === null) return null;
  try {
    return sealedDraftSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function openDraft(
  owner: DraftOwner,
  storageKey: string,
  raw: string | null,
): Promise<DraftRecord | null> {
  const sealed = parseSealed(raw);
  if (!sealed) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(sealed.iv),
        additionalData: new TextEncoder().encode(storageKey),
      },
      await cryptoKeyFor(owner.cipherKey),
      fromBase64(sealed.data),
    );
    return { code: new TextDecoder().decode(plain), savedAt: sealed.savedAt };
  } catch {
    return null;
  }
}

const legacyDraftSchema = z.object({ code: z.string(), savedAt: z.number() });

export function legacyDraftKey(key: DraftKey): string {
  return `nojv:draft:v1:${contextSegment(key.context)}:${key.problemId}:${key.language}`;
}

async function adoptLegacyDraft(key: DraftKey): Promise<DraftRecord | null> {
  const legacyKey = legacyDraftKey(key);
  let legacy: DraftRecord;
  try {
    legacy = legacyDraftSchema.parse(JSON.parse(localStorage.getItem(legacyKey) ?? ""));
  } catch {
    return null;
  }
  try {
    const record = await saveDraft(key, legacy.code);
    localStorage.removeItem(legacyKey);
    return record;
  } catch {
    return legacy;
  }
}

export async function loadDraft(key: DraftKey): Promise<DraftRecord | null> {
  const storageKey = buildDraftKey(key);
  const record = await openDraft(key.context, storageKey, localStorage.getItem(storageKey));
  if (record || key.context.kind === "exam") return record;
  return adoptLegacyDraft(key);
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
    entries.push({
      storageKey,
      savedAt: parseSealed(localStorage.getItem(storageKey))?.savedAt ?? 0,
    });
  }
  entries.sort((a, b) => a.savedAt - b.savedAt);
  return entries;
}

export async function saveDraft(key: DraftKey, code: string): Promise<DraftRecord> {
  const storageKey = buildDraftKey(key);
  const { record, serialized } = await sealDraft(key.context, storageKey, code);

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

export function draftContextFromSubmissionContext(
  context: SubmissionContext,
  owner: DraftOwner,
): DraftContext {
  switch (context.type) {
    case "practice":
      return { ...owner, kind: "practice" };
    case "exam":
      return { ...owner, kind: "exam", examId: context.examId };
    case "assignment":
      return { ...owner, kind: "assignment", assignmentId: context.assessmentId };
    case "contest":
      return { ...owner, kind: "contest", contestId: context.contestId };
    case "virtual":
      return { ...owner, kind: "virtual", participationId: context.participationId };
  }
}
