# Submission IDs

Show submission IDs and the copy action only in submission detail views (including expanded workspace history and source comparisons), using the existing [design system](../../architecture/DESIGN.md) and CopyButton. Preserve unrelated work already in the checkout.

- [x] Inventory history, detail, dashboard, admin errors, assessment feeds, and problem workspace.
- [x] Add the shared ID display and cover source comparisons.
- [x] Verify copying without navigation, keyboard behavior, and responsive layouts.
- [x] Capture local screenshots and report checks.

Tables and lists omit submission IDs and copy controls. In detail views, the ID appears as a labeled metadata field below language and submission time, with the copy button aligned to the right; the verdict and score remain the primary information. Aggregate scores and submission counts retain their current presentation.

Validation: focused tests cover tables without IDs or copy controls and working copy controls in submission details; Svelte check, web lint, test typechecking, and diff whitespace check passed. Browser clipboard readback verified full IDs with mouse and keyboard. Desktop/mobile and dark-theme screenshots are in `output/playwright/submission-id-*.png`. The preview uses an isolated local database copied from E2E fixtures because existing local schemas were stale. No deployment was performed.
