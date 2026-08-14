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

## Risks

- Storage-reference accounting and Accepted reference-snapshot ownership must stay consistent when a transaction rolls back.
- Updating an activity must not fork an already actor-owned problem again.
