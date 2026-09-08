# Email Change Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the four requested changes on PR #426 so email-change requests are secure, accurately described for verified and unverified accounts, and recoverable after invalid or expired verification links.

**Architecture:** Keep Better Auth as the source of truth for the two email-change paths. The settings server action selects the success copy from the authenticated session's `emailVerified` state, while a dedicated rate-limited resend action invokes Better Auth's `sendVerificationEmail` endpoint. Settings load maps Better Auth's callback error query values into localized UI data; the email-change component renders the alert and resend form.

**Tech Stack:** SvelteKit server actions/load functions, Svelte 5, `sveltekit-superforms`, Better Auth 1.6.23, Paraglide messages, Vitest.

**Spec:** PR #426 requested changes and inline review comments.

## Global Constraints

- Preserve Better Auth's existing two-stage flow for verified accounts and direct-new-address verification for unverified accounts.
- Never interpolate a user-controlled email address into HTML without escaping.
- Keep all email-related actions behind the existing `withRateLimit` wrapper.
- Keep English and zh-TW message keys in sync.
- Add regression tests before production changes and run targeted tests plus `git diff --check`.

### Task 1: Add regression coverage for review behavior

**Files:**

- Modify: `tests/unit/web/settings-change-email.test.ts`
- Modify: `tests/unit/web/settings-rate-limit-composition.test.ts`
- Create: `tests/unit/web/auth-email-change-wiring.test.ts`

**Interfaces:**

- Tests consume the settings action contract and captured Better Auth options.
- Tests produce expectations for dynamic success message keys, resend behavior, initial form errors, and escaped confirmation-email content.

- [ ] **Step 1: Write failing tests**
  - Assert verified sessions return `account_emailChange_verificationSent`.
  - Assert unverified sessions return `account_emailChange_verificationSentUnverified`.
  - Assert the load form is initialized with errors disabled.
  - Assert `resendEmailVerification` calls `sendVerificationEmail` with the current email and settings callback URL, and maps Better Auth failures to a form error.
  - Assert the captured `sendChangeEmailConfirmation` callback does not leave `<script>`/raw quoted email markup in rendered HTML.
  - Assert settings load maps `INVALID_TOKEN` and `TOKEN_EXPIRED` to their localized error keys.
- [ ] **Step 2: Run the new tests and verify they fail for the expected missing behavior**

```bash
CI=true pnpm exec vitest run --project unit tests/unit/web/settings-change-email.test.ts tests/unit/web/settings-rate-limit-composition.test.ts tests/unit/web/auth-email-change-wiring.test.ts
```

Expected: failures for the missing unverified success key, resend action, error-aware load data, and HTML escaping.

### Task 2: Fix server-side email-change and verification flows

**Files:**

- Modify: `apps/web/src/routes/(app)/settings/+page.server.ts`
- Modify: `apps/web/src/lib/auth.server.ts`

**Interfaces:**

- `load` returns `emailVerificationError: "invalidToken" | "tokenExpired" | null`.
- `changeEmail` returns the existing verified success key or the new unverified success key based on `actor.emailVerified`.
- `resendEmailVerification` is a rate-limited action that calls `getAuth().api.sendVerificationEmail` with `{ email, callbackURL: "/settings" }`.

- [ ] **Step 1: Initialize the email form without initial validation errors**

```ts
const emailForm = await superValidate({ newEmail: "" }, zod4(changeEmailSchema), {
  errors: false,
});
```

- [ ] **Step 2: Map callback query errors in `load`**
  - Read `event.url.searchParams.get("error")`.
  - Return `invalidToken` for `INVALID_TOKEN` and `TOKEN_EXPIRED` for `TOKEN_EXPIRED`; return `null` for other values.
- [ ] **Step 3: Add the unverified-account success message selection**
  - Store `const actor = requireAuth(event)` once at the start of the action.
  - Call Better Auth as before, then return `account_emailChange_verificationSent` only when `actor.emailVerified` is true; otherwise return `account_emailChange_verificationSentUnverified`.
- [ ] **Step 4: Add the rate-limited resend action**
  - Require authentication and call `sendVerificationEmail` using the session headers and `event.locals.user.email`.
  - Use `callbackURL: "/settings"` so invalid/expired links return to the settings page.
  - Return a localized success or error `FormMessage` without exposing Better Auth internals.
- [ ] **Step 5: Escape the user-controlled address before constructing the confirmation-email intro**
  - Add a local HTML escape helper for `&`, `<`, `>`, `"`, and `'` in `auth.server.ts`.
  - Use the escaped value only in the HTML intro; keep the actual `to` address and Better Auth token untouched.
- [ ] **Step 6: Run the targeted tests and confirm they pass**

```bash
CI=true pnpm exec vitest run --project unit tests/unit/web/settings-change-email.test.ts tests/unit/web/settings-rate-limit-composition.test.ts tests/unit/web/auth-email-change-wiring.test.ts
```

### Task 3: Add localized settings UI for verification errors and resend

**Files:**

- Modify: `apps/web/src/lib/components/features/account/EmailChangeForm.svelte`
- Modify: `apps/web/src/routes/(app)/settings/+page.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

**Interfaces:**

- `EmailChangeForm` accepts `verificationError: "invalidToken" | "tokenExpired" | null`.
- The component shows a localized alert and a `?/resendEmailVerification` form only for those callback errors.

- [ ] **Step 1: Add bilingual copy keys**
  - Add distinct success text for unverified accounts.
  - Add invalid-token, expired-token, resend, resend-success, and resend-failed labels/messages in both locale files.
- [ ] **Step 2: Pass the server load value into `EmailChangeForm`**
- [ ] **Step 3: Render the callback error and resend entry**
  - Use SvelteKit `enhance` to submit the resend form without navigation.
  - Show loading state, success toast, and an alert on failure.
  - Keep the existing change-email form behavior unchanged.
- [ ] **Step 4: Compile Paraglide and run Svelte type checks**

```bash
pnpm --filter @nojv/web paraglide:compile
pnpm --filter @nojv/web check
```

### Task 4: Full verification and PR update

**Files:**

- Verify: all changed files and generated Paraglide output

- [ ] **Step 1: Run targeted tests again after UI wiring**
- [ ] **Step 2: Run `git diff --check` and inspect `git status`**
- [ ] **Step 3: Run the full unit suite; distinguish feature failures from known environment failures**
- [ ] **Step 4: Commit the fixes and push `codex/allow-email-change`**
- [ ] **Step 5: Reply to each inline review thread with the concrete fix and test evidence, then request another review**
