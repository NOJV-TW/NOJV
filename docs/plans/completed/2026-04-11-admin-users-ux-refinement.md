# Admin Users UX Refinement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-submit role dropdown in `/admin/users` with a two-step editing UX (badge display → edit mode → explicit save with confirmation), wire in toast feedback for role changes and account disables, and remove the redundant role-mix card from `/admin`.

**Architecture:** Pure UI refinement. No domain changes, no schema changes, no new components. Reuses the existing global `toasts` store (`$lib/stores/toast`) whose `ToastContainer` is already mounted in `+layout.svelte`. New i18n strings go through Paraglide (`m.*`); the page's existing local zh/en dictionary is left alone (full i18n unification is out of scope). Verification is manual — the underlying domain functions (`updateUserRole`, `toggleUserDisabled`) are unchanged, so no new unit tests are required. The spec is at `docs/superpowers/specs/2026-04-11-admin-users-ux-refinement-design.md`.

**Tech Stack:** SvelteKit (Svelte 5 runes), `use:enhance`, Tailwind, Paraglide i18n, existing `$lib/components/ui/badge` variants (`warning` / `info` / `success`).

---

## File structure

**Modified:**

- `apps/web/messages/zh-TW.json` — add new keys.
- `apps/web/messages/en.json` — add matching keys.
- `apps/web/src/routes/(app)/admin/+page.svelte` — delete the `roleMix` card.
- `apps/web/src/routes/(app)/admin/users/+page.svelte` — the main refactor.

**Not modified:**

- `apps/web/src/routes/(app)/admin/users/+page.server.ts` — already returns `fail(400, { error })` / `{ success: true }` which is what the new enhance handlers expect. Leave it alone unless a task below flags an issue.
- `apps/web/src/routes/(app)/admin/announcements/*` — unchanged.
- Any domain / Prisma / repository code — unchanged.

---

## Task 1: Add Paraglide i18n keys

**Files:**

- Modify: `apps/web/messages/zh-TW.json` (insert near existing `admin_users*` keys, around line 677)
- Modify: `apps/web/messages/en.json` (same keys in the equivalent location)

- [ ] **Step 1: Add keys to `apps/web/messages/zh-TW.json`**

Find the line `"admin_usersEmptyHint": "請嘗試不同的搜尋關鍵字或角色篩選。",` and insert the following keys immediately after it (before `"admin_announcementsTitle"`):

```json
  "admin_usersRoleEdit": "編輯角色",
  "admin_usersRoleSave": "儲存",
  "admin_usersRoleCancel": "取消",
  "admin_usersRoleChangeDiff": "將 {username} 從 {from} 變更為 {to}",
  "admin_usersRoleDemoteConfirm": "確定要將 {username} 從 admin 降為 {to}？",
  "admin_usersRoleSelfBlocked": "不能變更自己的角色。",
  "admin_usersRoleUpdateSuccess": "{username} 的角色已更新為 {to}",
  "admin_usersRoleUpdateFailed": "角色更新失敗，請重試。",
  "admin_usersDisableConfirm": "確定要停用使用者 {username}？停用後該用戶無法登入。",
  "admin_usersDisableSelfBlocked": "不能停用自己的帳號。",
  "admin_usersDisableSuccess": "已停用使用者 {username}",
  "admin_usersEnableSuccess": "已啟用使用者 {username}",
  "admin_usersDisableFailed": "操作失敗，請重試。",
```

- [ ] **Step 2: Add matching keys to `apps/web/messages/en.json`**

Find the same insertion point (after `admin_usersEmptyHint`, before `admin_announcementsTitle`) and add:

```json
  "admin_usersRoleEdit": "Edit role",
  "admin_usersRoleSave": "Save",
  "admin_usersRoleCancel": "Cancel",
  "admin_usersRoleChangeDiff": "Change {username} from {from} to {to}",
  "admin_usersRoleDemoteConfirm": "Demote {username} from admin to {to}?",
  "admin_usersRoleSelfBlocked": "You cannot change your own role.",
  "admin_usersRoleUpdateSuccess": "{username}'s role updated to {to}",
  "admin_usersRoleUpdateFailed": "Failed to update role. Please try again.",
  "admin_usersDisableConfirm": "Disable user {username}? They will no longer be able to sign in.",
  "admin_usersDisableSelfBlocked": "You cannot disable your own account.",
  "admin_usersDisableSuccess": "Disabled user {username}",
  "admin_usersEnableSuccess": "Enabled user {username}",
  "admin_usersDisableFailed": "Action failed. Please try again.",
```

- [ ] **Step 3: Regenerate Paraglide output and typecheck**

Paraglide generates a TypeScript module under `$lib/paraglide/messages.js`. Regeneration happens automatically when `pnpm dev` is running, but for a clean check:

Run: `pnpm -w -F @nojv/web check`
Expected: No TypeScript errors. If Paraglide hasn't picked up the new keys, run `pnpm -w -F @nojv/web dev` briefly (Paraglide's Vite plugin regenerates on startup) and then re-run `check`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/zh-TW.json apps/web/messages/en.json
git commit -m "i18n(admin): add users role/disable UX strings"
```

---

## Task 2: Trim `/admin` overview — remove redundant role-mix card

**Files:**

- Modify: `apps/web/src/routes/(app)/admin/+page.svelte` (around lines 387–408)

- [ ] **Step 1: Delete the roleMix card**

Open `apps/web/src/routes/(app)/admin/+page.svelte` and delete the entire `<Card>` block that starts with the `UserCog` icon heading. Specifically, remove lines 387–408:

```svelte
<Card variant="surface" size="md">
  <h2
    class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground"
  >
    <UserCog class="h-3.5 w-3.5" />
    {t("roleMix")}
  </h2>
  <div class="grid gap-3 sm:grid-cols-3">
    <div class="rounded-sm border border-border-subtle px-3 py-3">
      <p class="text-caption uppercase tracking-wider text-muted-foreground">{t("admin")}</p>
      <p class="mt-1 font-display text-title-sm font-semibold tabular-nums">
        {data.roleCounts.admin}
      </p>
      <p class="text-caption text-muted-foreground">
        {pct(data.roleCounts.admin, data.kpi.totalUsers)}
      </p>
    </div>
    <div class="rounded-sm border border-border-subtle px-3 py-3">
      <p class="text-caption uppercase tracking-wider text-muted-foreground">{t("teacher")}</p>
      <p class="mt-1 font-display text-title-sm font-semibold tabular-nums">
        {data.roleCounts.teacher}
      </p>
      <p class="text-caption text-muted-foreground">
        {pct(data.roleCounts.teacher, data.kpi.totalUsers)}
      </p>
    </div>
    <div class="rounded-sm border border-border-subtle px-3 py-3">
      <p class="text-caption uppercase tracking-wider text-muted-foreground">{t("student")}</p>
      <p class="mt-1 font-display text-title-sm font-semibold tabular-nums">
        {data.roleCounts.student}
      </p>
      <p class="text-caption text-muted-foreground">
        {pct(data.roleCounts.student, data.kpi.totalUsers)}
      </p>
    </div>
  </div>
</Card>
```

- [ ] **Step 2: Remove now-unused imports / locals**

The deleted card was the only consumer of `UserCog` and the `pct()` function on this page. Check:

- In the `<script>` block, remove `UserCog` from the `@lucide/svelte` import list.
- Remove the `function pct(value: number, total: number): string { ... }` definition (around lines 210–213).
- Remove the `roleMix` and `roleSubtitle` keys from both the `en` and `zh` dictionaries inside `text` (they were only used by the deleted card's `t("roleMix")` label and the existing chart card's `t("roleSubtitle")`).

Wait — `roleSubtitle` is still used by the `userRoleDist` chart card above (`<p class="mt-1 text-caption text-muted-foreground">{t("roleSubtitle")}</p>`). **Keep `roleSubtitle`; only remove `roleMix`.**

After this step the file should compile with no unused-identifier warnings.

- [ ] **Step 3: Verify**

Run: `pnpm -w -F @nojv/web check`
Expected: no errors.

Run: `pnpm -w -F @nojv/web dev`, open `/admin` in a browser, confirm:

- The page renders.
- The bottom "Role mix quick view" card is gone.
- The `User role distribution` bar chart above it still renders with the three bars.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/(app)/admin/+page.svelte
git commit -m "refactor(admin): drop redundant role-mix card from overview"
```

---

## Task 3: `/admin/users` — introduce role badge display (read-only state)

This task adds the badge rendering without yet removing the existing select. After this task the page shows both the badge and the select temporarily — this is a deliberate intermediate commit so regressions are easy to bisect. Task 4 replaces the select with edit-mode gating.

**Files:**

- Modify: `apps/web/src/routes/(app)/admin/users/+page.svelte`

- [ ] **Step 1: Add a `roleBadgeVariant` helper**

Open `apps/web/src/routes/(app)/admin/users/+page.svelte`. Inside the `<script>` block, immediately after the existing `applyFilters` function (around line 104), add:

```ts
type PlatformRole = "admin" | "teacher" | "student";

function roleBadgeVariant(role: PlatformRole): "warning" | "info" | "success" {
  if (role === "admin") return "warning";
  if (role === "teacher") return "info";
  return "success";
}
```

- [ ] **Step 2: Render the badge above the existing select (temporary co-existence)**

Find the role cell in the table body (around lines 229–243):

```svelte
<td class="px-5 py-3">
  <form method="POST" action="?/updateRole" use:enhance>
    <input type="hidden" name="userId" value={user.id} />
    <select
      class="rounded-sm border border-input bg-background px-2 py-1 text-caption"
      name="role"
      value={user.platformRole}
      onchange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      <option value="admin">admin</option>
      <option value="teacher">teacher</option>
      <option value="student">student</option>
    </select>
  </form>
</td>
```

Replace with:

```svelte
<td class="px-5 py-3">
  <div class="flex items-center gap-2">
    <Badge variant={roleBadgeVariant(user.platformRole)} size="sm">
      {user.platformRole}
    </Badge>
    <form method="POST" action="?/updateRole" use:enhance>
      <input type="hidden" name="userId" value={user.id} />
      <select
        class="rounded-sm border border-input bg-background px-2 py-1 text-caption"
        name="role"
        value={user.platformRole}
        onchange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="admin">admin</option>
        <option value="teacher">teacher</option>
        <option value="student">student</option>
      </select>
    </form>
  </div>
</td>
```

`Badge` is already imported at the top of the file — no new imports.

- [ ] **Step 3: Verify**

Run: `pnpm -w -F @nojv/web check`
Expected: no errors.

Open `/admin/users` in the browser and confirm each row shows a colored badge next to the select:

- `admin` → orange badge
- `teacher` → blue badge
- `student` → green badge

The select still auto-submits on change (unchanged behaviour). Changing a role should update the badge colour after the page re-loads its data.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/(app)/admin/users/+page.svelte
git commit -m "feat(admin/users): show role as colored badge (intermediate step)"
```

---

## Task 4: `/admin/users` — replace select with click-to-edit mode

**Files:**

- Modify: `apps/web/src/routes/(app)/admin/users/+page.svelte`

- [ ] **Step 1: Add editing state and draft role**

In the `<script>` block of `apps/web/src/routes/(app)/admin/users/+page.svelte`, after the `let roleValue = $state(...)` line (around line 97), add:

```ts
let editingUserId = $state<string | null>(null);
let draftRole = $state<PlatformRole>("student");

function beginEditRole(user: { id: string; platformRole: PlatformRole }) {
  editingUserId = user.id;
  draftRole = user.platformRole;
}

function cancelEditRole() {
  editingUserId = null;
}
```

- [ ] **Step 2: Replace the role cell with badge-as-button + edit form**

Replace the role `<td>` you modified in Task 3 (the whole cell starting `<td class="px-5 py-3">`) with:

```svelte
<td class="px-5 py-3">
  {#if editingUserId === user.id}
    <form method="POST" action="?/updateRole" class="flex flex-col gap-2" use:enhance>
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="role" value={draftRole} />
      <select
        class="rounded-sm border border-input bg-background px-2 py-1 text-caption"
        bind:value={draftRole}
      >
        <option value="admin">admin</option>
        <option value="teacher">teacher</option>
        <option value="student">student</option>
      </select>
      {#if draftRole !== user.platformRole}
        <p class="text-caption text-muted-foreground">
          {m.admin_usersRoleChangeDiff({
            username: user.username ?? user.name,
            from: user.platformRole,
            to: draftRole,
          })}
        </p>
      {/if}
      <div class="flex items-center gap-1">
        <Button
          type="submit"
          variant="default"
          size="sm"
          disabled={draftRole === user.platformRole}
        >
          {m.admin_usersRoleSave()}
        </Button>
        <Button type="button" variant="ghost" size="sm" onclick={cancelEditRole}>
          {m.admin_usersRoleCancel()}
        </Button>
      </div>
    </form>
  {:else}
    <button
      type="button"
      class="inline-flex cursor-pointer items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={m.admin_usersRoleEdit()}
      onclick={() => beginEditRole(user)}
    >
      <Badge variant={roleBadgeVariant(user.platformRole)} size="sm">
        {user.platformRole}
      </Badge>
    </button>
  {/if}
</td>
```

**Important:** The form submits two hidden inputs (`userId` and `role`) because a `bind:value`'d `<select>` without a `name` attribute does NOT include its value in the form data. We drive the submitted value through a separate hidden input to keep the server action contract unchanged (it still reads `role` from form data).

- [ ] **Step 3: Verify the draftRole hidden input stays in sync**

Svelte 5 runes with `bind:value` re-render the hidden input's `value={draftRole}` reactively. Double-check by adding a temporary `<p>DEBUG: {draftRole}</p>` below the select in the edit form, running dev, switching the select, and watching it update. Remove the debug line before committing.

- [ ] **Step 4: Import `m` is already in place**

`import { m } from "$lib/paraglide/messages.js";` is already at the top of the file (line 15). Nothing to add.

- [ ] **Step 5: Verify**

Run: `pnpm -w -F @nojv/web check`
Expected: no errors.

Browser checks at `/admin/users`:

- Each role cell shows a colored badge (not a select).
- Clicking a badge turns the cell into an edit form with select + Save + Cancel.
- Save is disabled until the select value differs from the original role.
- Changing the select shows the "將 X 從 A 變更為 B" diff line.
- Clicking Cancel closes edit mode and restores the badge.
- Clicking Save submits the form — it should still round-trip through the server (no confirm yet — that's Task 5) and the page re-renders with the new badge. Also confirm the enable/disable button in the last column is unaffected.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/(app)/admin/users/+page.svelte
git commit -m "feat(admin/users): click-to-edit role with draft state and diff preview"
```

---

## Task 5: `/admin/users` — confirm gate + toast feedback for role change

**Files:**

- Modify: `apps/web/src/routes/(app)/admin/users/+page.svelte`

- [ ] **Step 1: Import the toasts store**

At the top of the `<script>` block (near the other `$lib` imports, around line 10), add:

```ts
import { toasts } from "$lib/components/ui/toast";
```

- [ ] **Step 2: Upgrade the `use:enhance` on the role edit form**

Replace the `use:enhance` attribute on the role edit form inside the `{#if editingUserId === user.id}` branch (from Task 4 step 2) with a callback form. Replace `use:enhance` with:

```svelte
                      use:enhance={({ cancel, formData }) => {
                        const submittedRole = String(formData.get("role") ?? "");
                        const targetUsername = user.username ?? user.name;

                        if (user.id === data.actor?.userId) {
                          toasts.error(m.admin_usersRoleSelfBlocked());
                          cancel();
                          return;
                        }

                        if (user.platformRole === "admin" && submittedRole !== "admin") {
                          const ok = confirm(
                            m.admin_usersRoleDemoteConfirm({
                              username: targetUsername,
                              to: submittedRole
                            })
                          );
                          if (!ok) {
                            cancel();
                            return;
                          }
                        }

                        return async ({ result, update }) => {
                          if (result.type === "success") {
                            toasts.success(
                              m.admin_usersRoleUpdateSuccess({
                                username: targetUsername,
                                to: submittedRole
                              })
                            );
                            editingUserId = null;
                            await update();
                          } else if (result.type === "failure") {
                            const err =
                              (result.data as { error?: string } | undefined)?.error ??
                              m.admin_usersRoleUpdateFailed();
                            toasts.error(err);
                            // Leave edit mode open so the admin can retry or cancel.
                          } else {
                            await update();
                          }
                        };
                      }}
```

- [ ] **Step 3: Ensure `data.actor` is available on the page**

The layout `load` in `apps/web/src/routes/(app)/admin/+layout.server.ts` already returns `{ actor }`. SvelteKit merges layout data into child pages' `data` prop automatically, so `data.actor?.userId` is available. Verify by reading the file once:

Run: `cat apps/web/src/routes/(app)/admin/+layout.server.ts`
Expected output contains `return { actor };`.

If for some reason `actor` is not in `data`, add it to `apps/web/src/routes/(app)/admin/users/+page.server.ts`'s `load` by returning it alongside the existing data — but prefer the layout-provided value if it's already there.

- [ ] **Step 4: Verify**

Run: `pnpm -w -F @nojv/web check`
Expected: no errors.

Browser checks at `/admin/users`:

- Pick a non-admin user, change their role to something else, Save → success toast appears, row returns to badge view, new colour reflected.
- Pick an admin user (other than yourself), change to student, Save → `confirm()` dialog appears. Cancelling leaves edit mode open; confirming commits with a toast.
- Open your own row, try to change your role, Save → error toast "不能變更自己的角色。", no server round-trip. (The server will also reject this with "Cannot change your own role." as a safety net if the client check is bypassed.)
- Simulate failure: temporarily rename the hidden `role` input to `rolex` in the form source, try to save → should see `toasts.error` with the server's 400 message. Revert the rename after verifying.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/(app)/admin/users/+page.svelte
git commit -m "feat(admin/users): confirm demotions and surface role changes via toast"
```

---

## Task 6: `/admin/users` — confirm + toast on enable/disable

**Files:**

- Modify: `apps/web/src/routes/(app)/admin/users/+page.svelte`

- [ ] **Step 1: Upgrade the `use:enhance` on the toggleDisabled form**

Find the enable/disable form in the last table column (around lines 254–268 before your edits, but shift accordingly after Tasks 3–5):

```svelte
<form method="POST" action="?/toggleDisabled" use:enhance>
  <input type="hidden" name="userId" value={user.id} />
  <Button type="submit" ...>
    {user.disabled ? t("enable") : t("disable")}
  </Button>
</form>
```

Replace `use:enhance` with:

```svelte
                  use:enhance={({ cancel }) => {
                    const targetUsername = user.username ?? user.name;
                    const willDisable = !user.disabled;

                    if (user.id === data.actor?.userId) {
                      toasts.error(m.admin_usersDisableSelfBlocked());
                      cancel();
                      return;
                    }

                    if (willDisable) {
                      const ok = confirm(
                        m.admin_usersDisableConfirm({ username: targetUsername })
                      );
                      if (!ok) {
                        cancel();
                        return;
                      }
                    }

                    return async ({ result, update }) => {
                      if (result.type === "success") {
                        toasts.success(
                          willDisable
                            ? m.admin_usersDisableSuccess({ username: targetUsername })
                            : m.admin_usersEnableSuccess({ username: targetUsername })
                        );
                        await update();
                      } else if (result.type === "failure") {
                        const err =
                          (result.data as { error?: string } | undefined)?.error ??
                          m.admin_usersDisableFailed();
                        toasts.error(err);
                      } else {
                        await update();
                      }
                    };
                  }}
```

- [ ] **Step 2: Verify**

Run: `pnpm -w -F @nojv/web check`
Expected: no errors.

Browser checks at `/admin/users`:

- Click Disable on an active non-self user → confirm dialog → cancel leaves state unchanged; confirm disables and shows success toast; status badge flips to "停用".
- Click Enable on a disabled user → no confirm (enabling is safe), success toast fires, badge flips back to "啟用".
- Click Disable on your own row → error toast "不能停用自己的帳號。", no server call.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/(app)/admin/users/+page.svelte
git commit -m "feat(admin/users): confirm disables and surface account state changes via toast"
```

---

## Task 7: Full-page manual verification and cleanup

**Files:**

- Possibly: `apps/web/src/routes/(app)/admin/users/+page.svelte` (cleanup only, if needed)

- [ ] **Step 1: Full lint + typecheck across the repo**

Run: `pnpm lint`
Expected: clean (or only pre-existing warnings unrelated to the touched files).

Run: `pnpm -w -F @nojv/web check`
Expected: no TypeScript errors.

- [ ] **Step 2: Golden-path smoke test in the browser**

With `pnpm dev` running, log in as an admin user and walk through each scenario once more:

1. `/admin` — overview renders; no role-mix card at the bottom; role bar chart still present.
2. `/admin/users` — list renders with colored role badges.
3. Promote a student to teacher: click badge → select teacher → Save → success toast → badge turns blue.
4. Demote a teacher to student: click badge → select student → Save → success toast → badge turns green. (No confirm; only admin→X triggers confirm.)
5. Demote an admin to teacher: click badge → select teacher → Save → confirm dialog → accept → success toast → badge turns blue.
6. Try to edit your own role → error toast, no round-trip.
7. Disable a non-self user → confirm → accept → "已停用…" toast → status badge flips.
8. Re-enable that user → no confirm → "已啟用…" toast.
9. Try to disable yourself → error toast.
10. `/admin/announcements` — unchanged, still loads and functions.

- [ ] **Step 3: Cross-page regression check**

Open the home page and `/courses` briefly to make sure the toast container still mounts and no console errors are thrown. (This is cheap and catches global regressions from the `toasts` import.)

- [ ] **Step 4: Check for stray debug output**

Run: `git diff HEAD~6 -- apps/web/src/routes/\(app\)/admin/users/+page.svelte | grep -i "DEBUG\|console\."`
Expected: no matches. If any turn up, remove them and amend/new commit.

- [ ] **Step 5: Final commit if any cleanup happened**

If Step 4 turned up anything, fix inline and commit:

```bash
git add apps/web/src/routes/(app)/admin/users/+page.svelte
git commit -m "chore(admin/users): remove debug output"
```

Otherwise skip this step.

---

## Spec coverage checklist (for the reviewer)

- [x] `/admin` overview `roleMix` card removed → Task 2
- [x] `/admin/users` role rendered as coloured `Badge` mapped to `warning/info/success` → Task 3
- [x] Click-to-edit mode with draft state, diff description, Save / Cancel → Task 4
- [x] Save disabled while draft equals original → Task 4
- [x] High-risk confirm for admin demotion → Task 5
- [x] Client-side block for editing own role → Task 5
- [x] Toast success / failure on role change; failure preserves edit mode → Task 5
- [x] Confirm gate + toast on enable/disable → Task 6
- [x] Client-side block for disabling own account → Task 6
- [x] No changes to domain / Prisma / server actions' contract → confirmed in "File structure"
- [x] Announcements page untouched → confirmed in "File structure"
- [x] New strings go through Paraglide; local zh/en dictionary on the page not expanded → Task 1 (uses `m.*` only)
- [x] No new unit tests required → verification is manual per spec
