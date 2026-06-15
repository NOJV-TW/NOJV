# Account Edit — name + username

**Date**: 2026-04-16
**Scope**: Let authenticated users edit their own `name` and `username` from `/account`. Gate `username` edits behind ownership of the field's state (verified vs. not).

## Context

Today `/account` is read-only. `User.name` is seeded from the OAuth provider or email signup form; `User.username` is either set via placeholder merge (teacher bulk-paste → student signs in with a matching school email) or via the three-school verification flow (`/verify-school`).

"Verified" status is inferred by running `isReservedUsername(username)` against the student-ID regex — there is no dedicated column. Changing away from the student-ID pattern therefore silently drops the verified state.

## Decisions

1. **Editable fields**: `name`, `username`. Not `email`.
2. **Verified users cannot rename `username`**. Hard block, not a warning — the verified state _is_ the username format, so a warn+allow flow is incoherent. UI disables the input and explains.
3. **Non-verified users can rename `username`**, with:
   - duplicate check against active users → reject
   - duplicate against a `pending_first_login` placeholder → **auto-merge** via the existing `attachPlaceholderToAuth` logic so the user inherits any course memberships the placeholder held
   - format check: `/^[a-z0-9._-]+$/`, length 1–64 (aligned with better-auth plugin config)
   - **reject student-ID-format usernames** (`isReservedUsername`) — closes the pre-existing hole where anyone could self-claim `41047001a` and appear verified.
4. **Placeholder users** (`status === 'pending_first_login'`) cannot rename — they are not real accounts.
5. **`displayUsername`** stays in the schema (better-auth plugin writes to it). New code continues to keep it in sync with `username` on rename.
6. **Email editing is out of scope** for this iteration.

## Domain layer

New file (or extend) `packages/application/src/user/mutations.ts`:

```ts
renameName(userId: string, newName: string): Promise<void>
  // trim, reject empty, length 1-64, update User.name

renameUsername(userId: string, newUsername: string): Promise<{ merged: boolean }>
  // inside runTransaction:
  //   1. load user; if status === 'pending_first_login' → throw ForbiddenError('PLACEHOLDER_LOCKED')
  //   2. if current username && isReservedUsername(current) → throw ConflictError('VERIFIED_LOCKED')
  //   3. normalize: trim + lowercase
  //   4. validate format /^[a-z0-9._-]+$/ and length 1-64
  //   5. reject isReservedUsername(new) → throw ConflictError('RESERVED_FORMAT')
  //   6. if new === current → return { merged: false }
  //   7. findByUsername(new):
  //        - none → update user.{username, displayUsername} = new → { merged: false }
  //        - status === 'pending_first_login' → attachPlaceholderToAuth(placeholder.id, user.id),
  //          then update remaining user.{username, displayUsername} = new → { merged: true }
  //        - otherwise → throw ConflictError('TAKEN')
```

Error classes come from `packages/application/src/shared/errors.ts` (existing `ConflictError`, add `ForbiddenError` if missing — check first).

## Server actions

`apps/web/src/routes/(app)/account/+page.server.ts`:

- Convert to superforms + zod4 (project convention).
- Schemas in `apps/web/src/routes/(app)/account/schemas.ts`:
  - `nameSchema`: `z.object({ name: z.string().trim().min(1).max(64) })`
  - `usernameSchema`: `z.object({ username: z.string().trim().min(1).max(64) })`
- Actions:
  - `updateName` → `userDomain.renameName(user.id, form.data.name)`
  - `updateUsername` → `userDomain.renameUsername(user.id, form.data.username)` → include `merged` in return
- Both wrapped with `consumeFormRateLimit`.
- `load` returns:
  ```ts
  {
    email, name, username, platformRole,
    isSchoolVerified,
    canEditUsername: !isSchoolVerified && status === 'active',
    nameForm: await superValidate(..., zod(nameSchema)),
    usernameForm: await superValidate(..., zod(usernameSchema))
  }
  ```

## UI

`apps/web/src/routes/(app)/account/+page.svelte`:

- Keep existing read-only summary Card.
- Add a new "Edit profile" Section with two stacked forms:
  - **Name**: single input + Save button.
  - **Username**: single input + Save button.
    - Disabled when `!data.canEditUsername`, with a muted helper line explaining the lock.
    - Helper text below the input: allowed characters + the student-ID-reserved caveat.
- On success:
  - `updateName` → toast `account_nameUpdated`
  - `updateUsername` + `merged: false` → toast `account_usernameUpdated`
  - `updateUsername` + `merged: true` → toast `account_mergedWithInvite` ("已合併邀請資料，你已加入老師先前指派的課程")
- On error: map error code → i18n string and display inline under the relevant input.

Error → message map:

| Code                 | zh-TW                            | en                                            |
| -------------------- | -------------------------------- | --------------------------------------------- |
| `VERIFIED_LOCKED`    | 已綁定學校驗證身分，無法修改     | Locked by school verification                 |
| `PLACEHOLDER_LOCKED` | 尚未啟用的帳號無法修改           | Placeholder accounts cannot be edited         |
| `RESERVED_FORMAT`    | 此格式為學號保留，請改用其他字串 | Reserved for student-ID format                |
| `TAKEN`              | 此帳號名稱已被使用               | Username already taken                        |
| zod format error     | 只能使用小寫英數、`.`、`-`、`_`  | Only lowercase letters, digits, `.`, `-`, `_` |

## i18n keys (new)

- `account_editProfile`, `account_editProfileHint`
- `account_editName`, `account_editUsername`, `account_save`
- `account_usernameHelper` (allowed-chars hint)
- `account_usernameLockedByVerification`
- `account_usernameLockedByPlaceholder`
- `account_usernameTaken`, `account_usernameReserved`, `account_usernameInvalid`
- `account_mergedWithInvite`, `account_nameUpdated`, `account_usernameUpdated`

After editing the JSON files, run:

```
pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide
```

(`svelte-kit sync` alone does not regenerate message types — learned in previous round.)

## Tests

### Unit — `tests/unit/domain/user-rename.test.ts`

1. `renameName`: trims, rejects empty, accepts max length, persists
2. `renameUsername`: happy path (non-verified → new), `merged: false`
3. `renameUsername`: verified user → `VERIFIED_LOCKED`
4. `renameUsername`: placeholder user → `PLACEHOLDER_LOCKED`
5. `renameUsername`: new === current → no-op
6. `renameUsername`: student-ID-format new → `RESERVED_FORMAT`
7. `renameUsername`: format violation (uppercase / whitespace / special) → zod/format error
8. `renameUsername`: active-user conflict → `TAKEN`
9. `renameUsername`: placeholder conflict → merges, memberships move to actor, placeholder row deleted, `merged: true`

### Integration — `tests/integration/api/account-edit.test.ts`

- POST `/account?/updateName` → DB `User.name` changes
- POST `/account?/updateUsername` on non-verified user → DB updated
- POST `/account?/updateUsername` to a placeholder's username → membership migrated, placeholder deleted
- POST `/account?/updateUsername` on verified user → 409

## Verification

```
1. Unit tests 9/9 pass
2. Integration tests pass
3. Browser manual:
   - Change name → reload → persists
   - Change username (non-verified) → persists, old name gone
   - Seed a placeholder in another course, rename self to that username → auto-joined
   - Log in as verified user → username input disabled with reason
4. pnpm -w typecheck && pnpm lint && pnpm -w format && pnpm test:unit → all green
```

## Out of scope

- Editing `email` (future iteration)
- Removing the `displayUsername` column (better-auth library coupling; decided to keep)
- Cleaning up `displayUsername ?? username ?? name` redundancy in `rank-util.ts` etc. (separate janitorial pass if wanted)
- Admin-side rename of another user's username
- "Unverify" flow (letting a verified user voluntarily drop verification so they can rename)
