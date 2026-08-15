# Problem Forks And Admin Visibility

## Problem

- Reference-answer validation can report an unexpected error after an Accepted submission and can be submitted twice.
- Public problems cannot be copied safely into independent author or activity-owned drafts.
- Admin content lists are constrained by ordinary course membership.
- The problem-library "all" tab generates the public-tab URL.

## Constraints

- Reuse the current judge generation, storage-reference ledger, activity mutations, cards, and `adminMayPublish` flag.
- Do not add a review queue, synchronization between forks, compatibility layer, pagination framework, or dependency.
- Activity creation or update and any required forks must commit atomically.

## Milestones

1. Fix reference validation state and problem-tab URL regressions with focused tests.
2. Add direct fork lineage and a single transactional deep-copy operation.
3. Route manual forks, activity problem resolution, and Admin publication through that operation.
4. Add Admin-only global course, assignment, exam, and contest lists using existing UI patterns.
5. Update living documentation and run focused plus full repository verification.

## Validation

- Focused unit and integration tests for error-state separation, duplicate submission prevention, URL generation, copy boundaries, authorization, rollback, activity resolution, and Admin visibility.
- `pnpm lint`, `pnpm format`, relevant type checks, integration and E2E coverage, then `pnpm ci:verify`.

## E2E Remediation

1. Replace the API-token test's hard-coded Redis container with the repository's existing `docker compose exec` pattern, then rerun `api-token-step-up.test.ts`.
2. Give the problem-lifecycle publication fixture an Accepted reference submission for the problem's current storage generation, then rerun `problem-lifecycle.test.ts`.
3. Remove the submission-lifecycle test's contradictory hidden-input mutation and select Public once through the visible control, then rerun `submission-lifecycle.test.ts`.
4. Wait for the hydrated settings page before opening Passkey management, then rerun `passkey-enroll.test.ts` and `passkey-stepup.test.ts`.
5. Drive Monaco through its rendered editor instead of the nonexistent `globalThis.monaco`, verify localStorage and rendered text across reload, then rerun `workspace-multifile.test.ts`.
6. Run the five failed files, the Admin/Fork focused files, the complete E2E suite, and `pnpm ci:verify`.

## Risks

- Storage-reference accounting and Accepted reference-snapshot ownership must stay consistent when a transaction rolls back.
- Updating an activity must not fork an already actor-owned problem again.
