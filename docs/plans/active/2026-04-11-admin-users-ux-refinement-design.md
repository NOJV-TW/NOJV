# Admin Interface Refinement — Role Management UX

**Date:** 2026-04-11
**Scope:** `apps/web/src/routes/(app)/admin/*`
**Status:** Design approved, awaiting spec review

## Background

The admin area currently has three pages: `/admin` (overview), `/admin/users`, `/admin/announcements`. Role assignment (including promoting/demoting teachers) happens inline in `/admin/users` via a `<select>` that auto-submits on `change`. This is error-prone: a single mis-click silently changes someone's platform role with no confirmation and no feedback beyond a full page reload.

Goal: refine the admin interface so that (a) the pages we keep are truly admin-only and well-scoped, (b) role changes and account disables are deliberate actions with visible state and clear feedback, and (c) teacher status is visually distinct from student/admin status in the user list.

Out of scope:
- Audit logging of role changes (deferred by product decision).
- Unifying the per-page zh/en local dictionaries in `/admin/+page.svelte` and `/admin/users/+page.svelte` with Paraglide (`m.*`). Tracked as separate i18n cleanup.
- Any changes to `/admin/announcements`.

## Decisions

1. **Keep all three admin pages.** Each has a non-overlapping responsibility:
   - `/admin` — global operational overview (KPIs, trends, health).
   - `/admin/users` — platform user management (search, role, enable/disable).
   - `/admin/announcements` — admin-only announcement publishing.
2. **`/admin` overview:** remove the redundant `roleMix` card at the bottom of the page. It duplicates the data already shown in the `userRoleDist` bar chart immediately above it.
3. **`/admin/users`:** replace the always-visible auto-submit `<select>` with a two-step edit pattern: display role as a colored badge by default, enter edit mode on click, commit via an explicit save button, confirm high-risk changes, and surface success/failure via the global toast store.
4. **`/admin/users`:** add a `confirm()` gate to the enable/disable button (same pattern already used by `/admin/announcements` delete).
5. **Announcements page:** no changes.

## Feature: `/admin` Overview Trim

### Change

Remove the `<Card>` titled "Role mix quick view" (the three-column `admin / teacher / student` count summary near the bottom of `apps/web/src/routes/(app)/admin/+page.svelte`). Nothing else on the overview changes.

### Why

The same three numbers are rendered directly above it as a bar chart (`userRoleDist`). Showing both forces the reader to cross-check two identical data points and adds visual weight without new information.

## Feature: `/admin/users` Role Editing UX

### Components (logical)

All UI changes live in `apps/web/src/routes/(app)/admin/users/+page.svelte`. No new Svelte components are introduced. The server action file (`+page.server.ts`) gets small adjustments to return structured error messages that the toast layer can display.

### Display state

Each row renders the role as a `<Badge>` whose variant maps to the role:

| Role      | Badge variant | Visual token |
|-----------|---------------|--------------|
| `admin`   | `warning`     | Orange       |
| `teacher` | `info`        | Blue         |
| `student` | `success`     | Green        |

All three variants already exist in `apps/web/src/lib/components/ui/badge/badge.svelte` (verified during spec drafting). The colour intent mirrors the palette used in `/admin/+page.svelte` (`#f97316`, `#3b82f6`, `#10b981`) for the role bar chart, so the two pages read consistently.

The badge is wrapped in a `<button>` (not a form submit) that toggles the row into **edit mode**. Only one row can be in edit mode at a time; opening a new row collapses any previously-open row (reverting unsaved changes).

### Edit mode

When a row enters edit mode, the role cell shows:

1. The existing `<select>` populated with `admin | teacher | student` and bound to a local `draftRole` state (initialised to the user's current role).
2. A short diff description underneath the select:
   - No change yet: hidden.
   - Change pending: e.g. "將 alice 從 teacher 變更為 student" / "Change alice from teacher to student".
3. A `Save` button (primary) and a `Cancel` button (ghost).

`Save` is disabled while `draftRole === user.platformRole`.

On `Cancel`, local state resets and the row returns to display mode.

### Submission

`Save` submits a form to the existing `?/updateRole` action using `use:enhance`. The enhance callback:

1. Runs the high-risk confirmation check (see below). If the user cancels, abort.
2. Lets the submission proceed.
3. In the result handler:
   - `result.type === "success"` → show `toasts.success("…")`, close edit mode, let SvelteKit refresh the data via `update()`.
   - `result.type === "failure"` → show `toasts.error("…")` with the server-provided error message, keep the row in edit mode so the admin can retry or cancel.

### High-risk confirmation

Trigger a native `confirm()` dialog (same pattern as the announcements delete form) before letting the submission proceed when **any** of the following apply:

- The current role is `admin` and the target role is anything else (demotion from admin).
- The target user is the currently authenticated admin (the server already rejects this with `"Cannot change your own role."`; the client should refuse to submit and show a toast explaining why, instead of round-tripping a failure).

Confirmation copy is localised and includes the target username and the transition, e.g. "確定要將 alice 從 admin 降為 student？".

### Enable / disable button

The `toggleDisabled` form currently submits immediately. Wrap it in `use:enhance` with a `confirm()` gate following the same pattern as the announcements delete:

- Enabling: no confirmation needed (always safe).
- Disabling: confirmation required, copy includes the target username, e.g. "確定要停用使用者 alice？停用後該用戶無法登入。".
- Result handler: `toasts.success` / `toasts.error` accordingly.
- As with role changes, refuse client-side if `userId === actor.userId` and show a toast.

### Server action changes

`apps/web/src/routes/(app)/admin/users/+page.server.ts`:

- Keep current validation and rate limiting.
- Update failure returns so `fail(400, { error: "…" })` returns the same shape already expected by the toast layer. Today the actions return either `fail` with an `{ error }` object or `{ success: true }` — that already matches. The only adjustment is to ensure error strings are human-readable (they already are) and that any new failure paths follow the same shape.
- No schema changes, no new actions, no repository changes. Role lookup, update, and disable still go through `userDomain.updateUserRole` and `userDomain.toggleUserDisabled`.

## Data flow

```
User clicks badge
  → row.editing = user.id, draftRole = user.platformRole
User picks new role in <select>
  → draftRole updates, diff description appears
User clicks Save
  → use:enhance submits ?/updateRole
  → enhance onSubmit checks confirmation conditions → cancel if refused
  → server action validates + calls updateUserRole
  → success: toasts.success, row.editing = null, SvelteKit invalidates load
  → failure: toasts.error, row stays in edit mode
```

Enable/disable flow is the same shape minus the edit mode, using `?/toggleDisabled`.

## Error handling

- **Rate limited** (`consumeFormRateLimit`): server already returns a `fail`; the enhance handler surfaces the message via `toasts.error`.
- **Invalid input** (malformed role, missing userId): server returns `fail(400, { error: "Invalid input." })`; handled identically.
- **Self-target**: client-side short-circuit with toast, plus existing server-side guard as defence-in-depth.
- **Not found** (disable only): server returns `fail(404)`; handled identically.
- **Network error / unknown**: enhance handler falls through to a generic `toasts.error(m.admin_usersRoleUpdateFailed())`.

No error boundary changes, no new exception types.

## Testing

This is a small, UI-layer refinement. Required checks:

1. **Lint / typecheck:** `pnpm lint` and `pnpm -w -F web check` (or equivalent) must pass.
2. **Manual verification** (cannot be replaced by unit tests — this is UI behaviour):
   - Promote a `student` to `teacher`: badge turns blue, success toast fires.
   - Demote an `admin` to `student`: confirm dialog appears; cancelling leaves state unchanged; confirming demotes.
   - Attempt to change your own role: client-side toast, no server round-trip.
   - Disable a user: confirm dialog appears; cancelling leaves state unchanged; confirming disables and toast fires.
   - Network failure simulated (devtools offline): error toast fires, edit mode is preserved.
3. **No new unit tests required.** The domain layer (`updateUserRole`, `toggleUserDisabled`) is unchanged. Any existing tests on those must still pass.

## String changes

New Paraglide keys in `apps/web/messages/zh-TW.json` and `apps/web/messages/en.json`:

- `admin_usersRoleEdit` — button / aria label for "Edit role".
- `admin_usersRoleSave` — "Save".
- `admin_usersRoleCancel` — "Cancel".
- `admin_usersRoleChangeDiff` — parameterised: `將 {username} 從 {from} 變更為 {to}`.
- `admin_usersRoleDemoteConfirm` — parameterised: `確定要將 {username} 從 admin 降為 {to}？`.
- `admin_usersRoleSelfBlocked` — `不能變更自己的角色。`.
- `admin_usersDisableConfirm` — parameterised: `確定要停用使用者 {username}？停用後該用戶無法登入。`.
- `admin_usersDisableSelfBlocked` — `不能停用自己的帳號。`.
- `admin_usersRoleUpdateSuccess` — parameterised: `{username} 的角色已更新為 {to}`.
- `admin_usersRoleUpdateFailed` — `角色更新失敗，請重試。`.
- `admin_usersDisableSuccess` / `admin_usersEnableSuccess` — parameterised by username.
- `admin_usersDisableFailed` — fallback error.

The page's **local** zh/en dictionary stays in place for the existing columns; new strings go through Paraglide (`m.*`) so we stop growing the local dictionary. This is a deliberate hybrid — the full i18n unification is a separate cleanup.

## Files touched

- `apps/web/src/routes/(app)/admin/+page.svelte` — remove `roleMix` card.
- `apps/web/src/routes/(app)/admin/users/+page.svelte` — main refactor (badge, edit mode, confirms, toast hooks).
- `apps/web/src/routes/(app)/admin/users/+page.server.ts` — minor: ensure failure shape is consistent (likely no functional change).
- `apps/web/messages/zh-TW.json` — add new keys.
- `apps/web/messages/en.json` — add new keys.

No new files. No deleted files.

## Open questions

None. Proceeding to implementation plan after spec review.
