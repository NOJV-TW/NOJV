# Code Draft Autosave (Ctrl+S) — Design

**Date:** 2026-05-11
**Scope:** Exam / Assignment / Contest 三個情境下的 problem workspace
**Status:** Design approved, ready to implement

## Goal

讓學生在考試、作業、比賽的解題畫面按 `Ctrl+S` 把當前程式碼存到瀏覽器本地,重新進入頁面時自動恢復。三個情境(以及練習頁)之間的草稿互相獨立。

## Non-Goals

- 不做伺服器端 draft API(現階段純本地)
- 不做跨裝置同步
- 不做自動定期保存(避免「靜默覆蓋使用者明明不想存的內容」)
- 不主動過期清理 localStorage(數字背書:5-10 MB 上限對程式碼草稿是天文數字)

## Architecture

### Storage layer — `apps/web/src/lib/stores/code-draft.ts`

純函式模組,只管 localStorage,不碰 Svelte。

**Key 格式:**

```
nojv:draft:v1:<context>:<problemId>:<language>
```

- `context` ∈ `practice` / `exam:<examId>` / `assignment:<assessmentId>` / `contest:<contestId>`
- `v1` 前綴留遷移空間
- Value: JSON `{ code: string, savedAt: number }`(epoch ms)

**Exports:**

```ts
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

export function buildDraftKey(key: DraftKey): string;
export function loadDraft(key: DraftKey): DraftRecord | null;
export function saveDraft(key: DraftKey, code: string): DraftRecord;
export function clearDraft(key: DraftKey): void;
```

**`saveDraft` quota fallback:**

```
try setItem
catch QuotaExceededError:
  enumerate localStorage keys starting with "nojv:draft:v1:"
  parse savedAt for each, sort ascending
  drop oldest entries one at a time, retry setItem until succeeds or list empty
  if still fails: throw (caller toast.error)
```

不掃 timestamp、不過期 — 只在「真的爆」的時候 lazy cleanup。

### Editor integration — `apps/web/src/lib/components/problem/Editor.svelte`

擴充現有的 `drafts: Record<string, string>`(per-language)機制。

**New props:**

```ts
draftContext: DraftContext;
```

從 problem workspace page server load 推斷,經 `+page.svelte` 傳進 Editor。

**Lifecycle:**

```
on mount + on language change:
  const key = { context, problemId, language }
  const record = loadDraft(key)
  if (record) {
    drafts[language] = record.code
    lastSavedCode[language] = record.code
    lastSavedAt[language] = record.savedAt
  } else {
    drafts[language] = initialProblem.starterByLanguage[language] ?? ""
    lastSavedCode[language] = drafts[language]
    lastSavedAt[language] = null
  }
```

**Dirty detection:**

```ts
const isDirty = $derived(drafts[language] !== lastSavedCode[language]);
```

**Save action:**

```ts
function saveCurrentDraft() {
  const code = drafts[language];
  saveDraft({ context, problemId, language }, code);
  lastSavedCode[language] = code;
  lastSavedAt[language] = Date.now();
  toast.success(m.draft_saved());
}
```

### Shortcut registration

利用現有 `shortcuts.svelte.ts` registry:

```ts
$effect(() => {
  return shortcuts.register({
    id: `editor-save:${problemId}`,
    keys: ["Ctrl", "S"],
    description: m.shortcut_saveDraft(),
    category: "actions",
    allowInInputs: true, // Monaco 是 contentEditable
    handler: () => saveCurrentDraft(),
  });
});
```

`allowInInputs: true` 是關鍵 — Monaco 編輯器內部是 contentEditable,registry 預設會跳過。

Cmd+S(Mac)在 `comboMatches` 已被歸一為 Ctrl,瀏覽器原生「儲存頁面」被 `preventDefault` 蓋掉。

### Status indicator UI — `EditorBottomPanel.svelte`

狀態列尾端,根據 `isDirty` / `lastSavedAt`:

| 狀態         | 顯示                                                              |
| ------------ | ----------------------------------------------------------------- |
| 從未存過     | `m.draft_none()` 「尚未儲存草稿」                                 |
| 已存且乾淨   | `m.draft_lastSavedAt({ time: HH:mm })` 「已儲存 16:42」           |
| 已存但 dirty | `● m.draft_unsaved()` 「● 未儲存」(`text-amber-500` 帶輕微 pulse) |

### Clear draft button (escape hatch)

狀態列尾端 `Trash` icon button,只在有草稿時顯示。

1. Confirm dialog:`m.draft_clearConfirm()` → 「清除這份草稿?Editor 會還原為 starter code」
2. 確認後:`clearDraft(key)` → `drafts[language] = starter` → `lastSavedAt[language] = null`

## Context inference

在 `+layout.svelte` / `+page.svelte` 用 `$page.route.id` 比對:

| route id                                                 | context                                |
| -------------------------------------------------------- | -------------------------------------- |
| `/(app)/exams/[examId]/problems/[problemId]`             | `{ kind: "exam", examId }`             |
| `/(app)/assignments/[assessmentId]/problems/[problemId]` | `{ kind: "assignment", assessmentId }` |
| `/(app)/contests/[contestId]/problems/[problemId]`       | `{ kind: "contest", contestId }`       |
| `/(app)/problems/[problemId]`                            | `{ kind: "practice" }`                 |

把這個推斷邏輯封裝成 `inferDraftContext(routeId, params): DraftContext`,單元測試覆蓋。

## i18n keys

新增 paraglide messages(en + zh-TW):

- `draft_saved` — Toast「草稿已儲存」
- `draft_unsaved` — 狀態列「未儲存」
- `draft_lastSavedAt` — 狀態列「已儲存 {time}」
- `draft_none` — 狀態列「尚未儲存草稿」
- `draft_clearConfirm` — Confirm「清除這份草稿?Editor 會還原為 starter code」
- `draft_clearAction` — Button「清除草稿」
- `shortcut_saveDraft` — 快捷鍵說明「儲存草稿」

記得跑 `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`。

## Testing

**Unit (`tests/unit/code-draft.test.ts`):**

- `buildDraftKey` 對四種 context 都產出預期格式
- `saveDraft` → `loadDraft` round-trip
- `clearDraft` 後 load 為 null
- Quota fallback:mock `setItem` 第一次丟 `QuotaExceededError`,確認最舊 key 被砍且重試成功
- `inferDraftContext` 對四種 route id 正確分類

**Integration (Editor.svelte test):**

- 在 context A 存草稿 → 切到 context B 看到 starter,不會撈到 A 的草稿
- 切語言:python 草稿不會被 cpp 蓋掉
- Ctrl+S 後 toast 出現、`isDirty` 變 false、`lastSavedAt` 更新

**不做 e2e** — Playwright 對 Monaco 互動本來就脆,ROI 低。

## Risks & Mitigations

| 風險                        | 緩解                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monaco 把 Ctrl+S 自己吃掉   | registry handler 在 `keydown` capture phase,而且 `allowInInputs` 加上 `preventDefault` 應足夠 — 若實測發現 Monaco 攔到,改在 `Editor.svelte` 直接掛 `editor.addCommand(monaco.KeyMod.CtrlCmd \| monaco.KeyCode.KeyS, ...)` |
| Quota 真的爆                | Lazy cleanup;若仍爆,toast.error 告知使用者                                                                                                                                                                                |
| 草稿從之前的 `v0`(未來)     | `v1` 前綴避免新舊資料混                                                                                                                                                                                                   |
| Editor mount 時 prop 還沒到 | Svelte 5 reactive — `$effect` 重跑即可,key build 是 pure function 沒副作用                                                                                                                                                |

## Out of scope (future)

- 跨裝置同步(API)
- 自動定期儲存
- 比較草稿與 starter 的 diff UI
