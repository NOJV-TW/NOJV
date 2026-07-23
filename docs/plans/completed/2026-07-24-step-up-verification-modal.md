# Step-up Verification Modal Implementation Plan

**Status:** Completed

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:verification-before-completion before publishing.

**Goal:** Keep users on their current page while they complete the TOTP or passkey step-up required for Admin mode and API Token access.

**Architecture:** Reuse the existing verification page action and passkey handoff instead of creating a second verification protocol. Extract the existing form into one shared component, wrap it with the repository's Bits UI dialog for menu-triggered flows, and retain the page route for direct navigation. Add one session-only API endpoint so the API Token menu item can avoid prompting when its page grant is already fresh.

**Tech Stack:** SvelteKit 2, Svelte 5, Better Auth passkeys, Bits UI Dialog, Vitest, Playwright

---

### Task 1: Expose API Token page access state

**Files:**

- Create: `apps/web/src/routes/api/api-token-access/+server.ts`
- Modify: `tests/unit/web/api-tokens-step-up-gate.test.ts`

**Steps:**

1. Add failing unit cases for setup-required, verification-required, and already-unlocked sessions.
2. Run `pnpm exec vitest run --project unit tests/unit/web/api-tokens-step-up-gate.test.ts` and confirm the missing route fails.
3. Add a session-only GET handler that reuses `isTwoFactorActivated` and `hasTokenPageMfa`.
4. Run the targeted unit test and confirm it passes.

### Task 2: Share the existing verification UI

**Files:**

- Create: `apps/web/src/lib/components/features/account/StepUpForm.svelte`
- Create: `apps/web/src/lib/components/features/account/StepUpDialog.svelte`
- Modify: `apps/web/src/routes/(app)/account/api-tokens/verify/+page.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

**Steps:**

1. Move the TOTP form and passkey assertion flow from the verification page into `StepUpForm.svelte`.
2. Keep TOTP submissions pointed at the existing verification page action so replay protection, rate limiting, session marking, and fixed destinations remain server-owned.
3. Wrap the shared form in the existing Bits UI Dialog primitive with purpose-specific copy.
4. Render the same shared form from the direct verification page.
5. Compile messages with `pnpm --filter @nojv/web paraglide:compile`.
6. Run `pnpm --filter @nojv/web typecheck`.

### Task 3: Open the modal from the account menu

**Files:**

- Modify: `apps/web/src/lib/components/features/auth/UserMenu.svelte`
- Modify: `tests/e2e/admin-mfa-elevation.test.ts`
- Modify: `tests/e2e/passkey-stepup.test.ts`

**Steps:**

1. Make Admin mode open the shared dialog when `/api/admin-mode` returns `verificationRequired`.
2. Make the API Token menu item query `/api/api-token-access`; navigate immediately when unlocked or setup is required, otherwise open the dialog.
3. Use Better Auth's existing `listUserPasskeys` client method to decide whether the passkey option should be shown.
4. Update the TOTP Admin mode E2E and passkey API Token E2E to enter through the menu and assert the dialog is visible before verification.
5. Run the two focused Playwright tests.

### Task 4: Verify and publish

**Files:**

- Move: `docs/plans/active/2026-07-24-step-up-verification-modal.md` to `docs/plans/completed/2026-07-24-step-up-verification-modal.md`

**Steps:**

1. Run focused unit tests, web typecheck, format, and lint checks.
2. Run the repository's `pnpm ci:verify` gate.
3. Review the final diff for duplicated verification logic or weakened server checks.
4. Move this plan to completed, commit, push, and open a ready PR.
5. Merge only after required GitHub checks pass.
