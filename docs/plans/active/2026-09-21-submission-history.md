# Unified submission tracking and history

## Scope and approved behavior

Local implementation and verification across practice, assignments, exams, contests,
virtual contests, standard/advanced workspaces, submission details, reference
validation, single/batch rejudge, teacher results/matrices, and scoreboards.
No deployment, new state package, database table, or change to scoring/freeze rules.

- Background completion updates existing history/sibling indicators and a toast
  containing the problem title and verdict; no permanent notification panel.
- Status and judge generation are authoritative. Pending rejudges hide previous
  scores and details; terminal errors do not require a result file.
- Workspace history automatically appends batches of 50 with retry and no total cap.
- Teacher/standalone lists use numbered 50-row pages, scoped stable snapshots,
  and a new-submission prompt instead of moving the current reading position.
- Teacher results refresh while retaining filters, pagination, and unsaved edits.

## Milestones

- [x] Extend the operation contract with generation/timestamp and safe terminal summaries.
- [x] Add authorized pending discovery and batched status APIs.
- [x] Move tracking to the authenticated session with SSE wakeups, 5-second visible
      polling, 10-second reads, retry backoff, and late-response isolation.
- [x] Connect workspaces, details, reference validation, rejudge recovery, results,
      and contest-scoped scoreboard subscriptions.
- [x] Remove history caps and introduce scoped cursor/snapshot pagination.
- [x] Preserve teacher form drafts and grading revisions during background refresh.
- [x] Complete final local static/unit/component verification.
- [x] Obtain explicit consent and verify both local test database identities/markers.
- [x] Execute related database/API/Temporal integration tests.
- [x] Complete assignment/exam browser recovery and history regression flows.

## Regression matrix

The original seven bug-confirming probes have been replaced with assertions for
correct behavior in the permanent test suites. Shared service coverage is distinct
from rendering every possible surface/context combination.

| Surface                             | Scenarios                                                                                                                                                   | Evidence location / layer                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Standard + advanced workspaces      | Navigate before dispatch response; A→B completion; A history on return                                                                                      | editor-submission-navigation, submission-navigation-view / rendered components                                                           |
| Standard + advanced shared tracking | Pending recovery on B, multiple IDs, duplicate/missed SSE, reconnect/foreground, hung reads, late account response                                          | problem-submission, submission-service / mocked transport unit tests                                                                     |
| Workspace history                   | 151 rows, actual intersection callback, failure/retry retaining rows, detail hydration                                                                      | submission-history-panel / rendered component                                                                                            |
| Teacher + standalone history        | Second page completion, status-filter membership retained during background updates, latest/manual page reset, late old context                             | submission-history-tracking / rendered components                                                                                        |
| Single rejudge/detail               | Queued durable overlay, no old result, generation races, terminal error without blob                                                                        | submission-operations, submission-queries / application unit tests                                                                       |
| Batch rejudge                       | Queued/running/success/failure/cancel, captured target generations, omitted-target restoration, network failure keeps progress, restored workflow discovery | rejudge-dialog, rejudge-routes, submission-operations / component and unit tests                                                         |
| Reference                           | Return while judging; detail failure/retry; newer run clears details; old AC does not certify changed configuration                                         | reference-solution-section, problem-reference-read / component and domain tests                                                          |
| Teacher editing                     | Keep unsaved total/rows and original grading revision, reset on context change, Superforms page/action behavior                                             | teacher-submission-refresh / rendered components                                                                                         |
| Query authorization                 | 151 equal timestamps, snapshots/new-count, cross-context cursors, unauthorized IDs, active exam confinement, reference permission revocation                | integration/api/submission-exam-confinement and related DB/API integration tests / passed                                                |
| Real browser                        | Reload B, second tab, reconnect, A indicator and 151-row auto-scroll                                                                                        | e2e/submission-tracking / two real UI flows passed for assignments and exams; fixture-controlled judge completion                        |
| Scoreboard                          | Contest switch rebuilds subscription; existing permission/freeze rules remain server-side                                                                   | subscription lifecycle source review; e2e/scoreboard-freeze / eight authenticated API cases passed; contest-switch UI not browser-tested |

## Local verification — 2026-09-21

- Final `pnpm ci:verify` passed after pre-merge fixes: 368 unit files / 3,278 tests
  and 37 component files / 84 tests (3,362 total), plus format, guards, builds,
  lint, application typechecks, and test typechecks.
- `pnpm typecheck`: 20 tasks passed; Svelte reported zero errors and warnings.
- `pnpm typecheck:tests`: passed, including new component and E2E definitions.
- `pnpm lint`: 12 tasks passed, including repository guards.
- `pnpm --filter @nojv/web build`: passed with the Node adapter.
- Related DB/API/Temporal integration run: 11 files, 72 tests passed using
  the isolated test database and Redis instance.
- Playwright: 20 authenticated rejudge/scoreboard API cases passed; after fixing
  new fixture setup and hydration/navigation synchronization, both assignment/exam
  UI recovery/history flows passed in a separate run (22 related cases total).
- Final reference result guard: all five reference component tests passed;
  test typecheck and web build rerun successfully afterward.
- Modified files formatted; `git diff --check` passed.
- Independent source review identified and then rechecked teacher draft loss,
  terminal deduplication, blocked page refresh, reference validity, and context
  races. No remaining important finding was reported in that review.

## Pre-merge review follow-up

- Numbered history now observes the current row IDs through the shared batch tracker.
  Background list reads update the new-submission count without replacing page
  membership, order, page count, or total count when verdict filters change membership.
  Initial loads, navigation, and explicit refresh recompute the page.
- Queued result suppression covers batch dispatch as well as single rejudge. Temporal
  exposes selected submission IDs and generations internally after target capture;
  browser progress responses still contain only status and counts. Completed child
  generations stop the overlay, and cancellation or omitted targets restore terminal
  results with monotonic timestamps. Terminal progress is cached in existing
  DurableWork results; progress reads are coalesced per workflow.
- Moved the existing description-panel test import before the timed assertion body
  so parallel module compilation does not consume its five-second assertion deadline.
  Its assertions and timeout are unchanged.
- Added permanent component, DB, and Temporal regression coverage for these review
  findings. This changes tracking metadata, not judge scoring or cancellation rules.

## Validation boundary

The user explicitly approved initialization of local `127.0.0.1/nojv_test` and
`127.0.0.1/nojv_e2e_test` on 2026-09-21. Both database names and dedicated markers
were reverified before running their guarded setup with the user's consent. Only
these two databases were authorized for destructive setup. Verification used
a temporary Redis instance on loopback port 16379; the normal development Redis
was not cleared. The temporary Redis container was stopped after verification.
The browser regression controls DB verdict transitions and does not
certify the worker/sandbox pipeline.

Integration: 72 related tests across eleven DB/API/Temporal files passed after adding
SvelteKit's `depends` method to two SSR test events. No runtime change was needed
for these two harness failures. The final clean run passed all 72 tests together, including batch target capture
and terminal restoration. New DurableWork fixtures include required completion timestamps.
Browser fixtures use valid context identifiers and real source-storage pointers,
wait for pending discovery before going offline, and wait for SPA navigation before
opening history. The intentional offline phase can reject browser-WASM prewarming;
these passing scenarios do not establish a console-error-free browser session.

No CI, merge, deployment, or production acceptance is claimed. Existing untracked
`output/` content is unrelated and retained.

## References

- [Frontend](../../architecture/FRONTEND.md)
- [Testing strategy](../../runbooks/testing.md)
- [Judge pipeline](../../architecture/JUDGE_PIPELINE.md)

## Original audit evidence

The following observations describe the pre-fix state. They are retained to explain
root causes, not as a list of current unresolved runtime defects. Temporary probes
remain outside the repository at `/tmp/nojv-submission-tracking-audit/`.

### Shared causes

1. Tracking ownership follows the component or its in-memory request, while the
   judge operation persists independently. Reload, a new tab, and missing initial
   pending rows leave nothing to subscribe to.
2. Clients equate the presence of `result` with completion. Current operation
   status and judge generation are not the authoritative client contract. An old
   result can survive rejudge, while a terminal failure can have no result file.
3. Refreshing server-loaded data does not reconcile every local cache. Older
   pages, initialized component state, and independently polled lists stay stale.
4. Requests and subscriptions are not consistently bound to the current context;
   late responses can overwrite a reused component after navigation.

### Findings and evidence

| Priority | Surface and trigger                                                                                                    | Cause / effect                                                                                                                                                                                                                                                                                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Assignment, exam, contest sibling scores: submit A, go to B, then reload B or open B in another tab while A is pending | The surviving submit promise exists only in the original document. B loads only B's rows; A has no watcher. Global SSE displays a toast but does not refresh sibling scores, and reconnect does not reconcile missed results.                                                                                                                  | Reproduced missing A tracker and unchanged sibling indicator after 10 seconds. See [workspace](../../../apps/web/src/lib/components/features/problem/layouts/ProblemWorkspace.svelte), [submission helper](../../../apps/web/src/lib/services/problem-submission.ts), [SSE](../../../apps/web/src/lib/stores/sse.ts).                                                                                                                                                                                                                                                                                                           |
| P1       | Standalone submission history, including the admin redirect: a pending record on page 2 or later finishes              | Only page 1 is server-loaded. SSE/polling calls `invalidateAll`, but the displayed `pages[]` cache is never refreshed. Returning to a cached page reuses it. New records can also shift page boundaries against old cursors.                                                                                                                   | Reproduced page 2 remaining pending after the verdict callback refreshes page 1; only the original page-2 fetch occurs. Boundary shifts are source analysis. See [history page](<../../../apps/web/src/routes/(app)/submissions/+page.svelte>).                                                                                                                                                                                                                                                                                                                                                                                 |
| P1       | Single rejudge in workspace history; submission detail opened during rejudge                                           | Rejudge leaves the previous result storage pointer in place; API/detail readers expose it while status is running. Service accepts any non-null result as completion. Workspace merge preserves the old result when a pending snapshot omits it; detail derives pending status from the old verdict. The rejudge button only posts and toasts. | Reproduced running + old AC returning AC, and a rendered workspace retaining AC with no watcher after a pending snapshot. API/rejudge button/detail chains confirmed in source. See [operation API](../../../apps/web/src/routes/api/submissions/[id]/+server.ts), [service](../../../apps/web/src/lib/services/submission-service.ts), [rejudge mutation](../../../packages/application/src/submission/mutations.ts), [history panel](../../../apps/web/src/lib/components/features/problem/left-panel/SubmissionHistoryPanel.svelte), [detail](<../../../apps/web/src/routes/(app)/submissions/[submissionId]/+page.svelte>). |
| P1       | Any pending submission ending in `system_error` without a verdict-detail object                                        | Failure/sweeper paths persist terminal status and summary without a detail file. The API returns terminal status with null result. `executeSubmission` waits until its deadline; the new recovery watcher keeps polling without delivering completion or refreshing. A failed rejudge can also retain the older detail.                        | Reproduced four recovery reads over 15 seconds with no update/refresh. Server failure paths and service deadline confirmed in source. See [failure mutation](../../../packages/application/src/submission/mutations.ts), [sweeper](../../../packages/application/src/submission/sweep.ts), [submission helper](../../../apps/web/src/lib/services/problem-submission.ts).                                                                                                                                                                                                                                                       |
| P1       | Teacher assignment/exam submission feed: same-route context changes while a request is pending                         | The old request can write into the reused component after new context props arrive. Once set, `refreshedRows` also overrides subsequent server props.                                                                                                                                                                                          | Reproduced old context A response replacing displayed context B rows. See [live feed](../../../apps/web/src/lib/components/features/coursework/LiveSubmissionsFeed.svelte). This is stale display, not evidence of an authorization bypass.                                                                                                                                                                                                                                                                                                                                                                                     |
| P2       | Virtual contest: reload/new tab or loss of the original submission promise during judging                              | Initial history filters to `submissionVerdicts`, omitting queued/running and `system_error` records. With no loaded pending ID, recovery cannot start; the new older-page API has different status coverage. Simple SPA leave/return can still recover through the surviving submit promise's completion refresh.                              | Source-confirmed query/type mismatch; no browser reproduction. See [virtual history query](../../../packages/application/src/virtual-contest/queries.ts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P2       | Reference solution validation: leave, return while validating, then complete                                           | Initial status is copied once. There is no resumed watcher for the persisted submission ID; even a subsequent server refresh does not update local status. Failed validations skip invalidation.                                                                                                                                               | Source-confirmed. See [reference section](../../../apps/web/src/lib/components/features/problem/reference/ReferenceSolutionSection.svelte).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P2       | Batch rejudge: close dialog/navigate, or finish while viewing results                                                  | Closing drops the workflow ID and stops polling. Reopening cannot resume; completion does not invalidate the surrounding results.                                                                                                                                                                                                              | Source-confirmed. See [rejudge dialog](../../../apps/web/src/lib/components/features/problem/admin/RejudgeDialog.svelte).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P2       | Teacher results/matrices stay open while judging completes                                                             | Assignment/contest tabs switch local state; results and matrices remain load-time snapshots. Exam results also do not refresh while staying on the tab, although URL navigation reloads them. Feed polling refreshes only that feed.                                                                                                           | Source-confirmed refresh gap. Live-refresh expectations for every result surface should be explicit. See [assignment](<../../../apps/web/src/routes/(app)/assignments/[assignmentId]/+page.svelte>), [contest](<../../../apps/web/src/routes/(app)/contests/[contestId]/+page.svelte>), [exam](<../../../apps/web/src/routes/(app)/exams/[examId]/+page.svelte>).                                                                                                                                                                                                                                                               |
| P2       | Mounted workspace recovery GET never settles                                                                           | The ID remains in `inflight`; subsequent verdict events and five-second polls skip it. There is no request deadline.                                                                                                                                                                                                                           | Reproduced one GET and no retry across 60 seconds. See [submission helper](../../../apps/web/src/lib/services/problem-submission.ts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P2       | Teacher assignment/exam submission history exceeds 50 rows                                                             | Context query defaults to 50 (maximum configurable limit 100); the API returns only items and the feed has no cursor/pagination. Student-workspace pagination does not remove this separate total visibility cap.                                                                                                                              | Source-confirmed. See [context query](../../../packages/application/src/submission/queries.ts), [API](../../../apps/web/src/routes/api/submissions/+server.ts), [live feed](../../../apps/web/src/lib/components/features/coursework/LiveSubmissionsFeed.svelte).                                                                                                                                                                                                                                                                                                                                                               |
| P2       | Dedicated scoreboard: navigate between contests on the same route component                                            | `onMount` opens SSE for the initial contest and does not resubscribe when the ID changes.                                                                                                                                                                                                                                                      | Source-confirmed lifecycle gap, not browser-reproduced. Existing 30-second/visibility refresh mitigates permanent staleness. See [scoreboard](<../../../apps/web/src/routes/(app)/contests/[contestId]/scoreboard/+page.svelte>).                                                                                                                                                                                                                                                                                                                                                                                               |
