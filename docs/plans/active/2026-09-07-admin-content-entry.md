# Admin content entry points

## Problem and approach

The main navigation opens personal course, assignment, exam, and contest lists even
when admin mode is active. Reuse the existing `/admin/*` content lists, which already
query all resources and authorize the effective actor, and omit the unrelated admin
panel tabs on these lists. Keep detail-page settings tabs and existing mutation rules.

References: [Frontend](../../architecture/FRONTEND.md),
[Security](../../operations/SECURITY.md), [Testing](../../runbooks/testing.md).

## Checkpoints

- [x] Trace effective role, all four list queries, detail layouts, and mutation guards.
- [x] Route active admins to global lists and keep navigation selection accurate.
- [x] Verify regular-admin visibility and edits without membership, mode-off isolation,
      navigation, and absence of list tabs.

## Constraints

No stored-role authorization bypass, duplicate list implementation, or production write.
Existing lifecycle restrictions on edits remain enforced.

## Validation

- Full unit suite: 335 files, 2,831 tests passed.
- Admin content integration: 2 tests passed against safety-marked `nojv_test`;
  regular-admin reads and persisted edits cover all four resource types, with
  mode-off denial and no membership creation.
- Regular-admin MFA E2E: passed against safety-marked `nojv_e2e_test`; checks all
  four navigation links, active selection, redirects, absent list tabs, and mode exit.
- Web Svelte/type checks, test TypeScript checks, changed-source ESLint, and doc drift passed.
- Implementation is locally verified; not merged or deployed.
