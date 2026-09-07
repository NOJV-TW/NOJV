# Course roster independent of authentication

## Goal and accepted decisions

Replace placeholder Users with durable CourseMembership rows. Teachers can enroll and grade students before account creation. Preserve the eight production placeholders' eight memberships (seven students, one TA, two courses), then delete only those placeholder Users during the verified maintenance release. The inventory is a read-only snapshot and must be refreshed before writes.

- NTNU uses the bare student ID; NTU uses `ntu_`; NTUST uses `ntust_`. Teachers enter the full username. Do not add or guess prefixes.
- General usernames are supported: teacher entry authorizes eventual matching account ownership, including TA roles. No invitation or additional approval workflow.
- Assignment and exam manual scores and feedback work before activation. Keep existing timing and scoring-mode rules; do not fabricate participation or submission rows.
- School verification updates the existing User's username, preserving its ID, credentials, and submissions.
- On same-course collisions, the school roster row survives and its conflicting manual scores, feedback, and role win. Merge nonconflicting data and preserve both histories. General renames instead preserve the already-linked row and its conflicting data/role. Either row's removed status wins, subject to existing owner/teacher protections.
- Login and verification alone never reactivate a removed enrollment. Protected course owners/teacher roles remain protected.

## Model and integration contract

- CourseMembership: retain `id`; nullable `userId`, nullable `pendingUsername`, exactly one set; unique `(courseId,userId)` and `(courseId,pendingUsername)`. Retain roles, status, timestamps, and creator. Linked rows clear pendingUsername, and continue following userId through rename. User FK becomes Restrict; normal account deletion with memberships anonymizes/disables the User.
- Course grading subject is `courseMembershipId`; contest subject remains `userId`. ScoreOverride has optional fields for both and a context-dependent XOR constraint plus subject-specific uniqueness. SubmissionFeedback replaces studentUserId with required courseMembershipId.
- Audit logs add nullable courseMembershipId and sourceMembershipId (no FK to preserve history), retain nullable historical userId/studentUserId snapshots, add merge action. On merge, transfer current ownership while preserving origin IDs, event IDs, content, actor, and timestamp; append a merge decision event for each conflicting effective record.
- Course member DTO: `membershipId: string`, `userId: string|null`, `username: string|null`, `name: string`, `email: string|null`, role/status/timestamps, `isPending: boolean`. Members actions use membershipId.
- Shared matrix DTO: `rowId: string` (membership ID for courses, user ID for contests), `courseMembershipId: string|null`, `userId: string|null`, displayName/handle/cells/total. Shared math keys use rowId, never mislabel membership IDs as user IDs. Course gradebook/analytics roster DTOs also expose membershipId and nullable userId.
- Override create API is context-discriminated: assignment/exam require courseMembershipId and reject userId; contest requires userId and rejects courseMembershipId. Feedback create uses courseMembershipId. Student read APIs still accept authenticated User ID and resolve ownership through the membership.
- Enrollment/identity writers share a transaction-scoped roster identity advisory lock, then course locks in sorted ID order. Username update, verification token consumption, grade merge, and enrollment bind commit atomically. Existing database uniqueness remains the final guard.
- Identity entrypoints: ordinary username setup/rename, verified school OAuth, later school verification; enforce reserved IDs server-side and block better-auth generic profile updates from bypassing the application username mutation. Retry unfinished OAuth linking on a later login; never silently report success for a failed link.
- Pending rows appear in staff roster/matrices/gradebook/CSV/counts; notification recipient helpers return only actual user IDs. School and generic usernames remain independently validated. Submission/participation counts remain real activity only.
- On grade/identity change, converge existing exam participation via the existing durable work mechanism; no new queue or dependency.

## Delivery checkpoints

- [x] Model, atomic membership binding/merge, identity entrypoints, and real-DB tests.
- [x] Course grading/feedback APIs, scoring, query/DTO updates, and tests.
- [x] Members/gradebook/matrix UI, translations, CSV, and browser tests.
- [x] Atomic production migration, guarded cleanup, schema rollback fence, seed/docs cleanup, and migration rehearsal.
- [x] Full local checks and independent review.
- [x] Exact-head remote CI and authorized admin PR merge (PR #412, `bebf0857`).
- [ ] Production release, data, and workload verification (on hold for a later user instruction).

## Authorized review corrections

The user accepted two review fixes: identity merges must retain a removal from either roster row, and teachers need an unlinked username correction action preserving membership/grading identity. Do not add merge-rule explanations to the verification UI. Correction uses the existing identity/course locks and common linking flow, rejects already-linked/disabled accounts and same-course collisions, and does not merge another student's records. No schema migration is needed for these corrections.

- [x] Removal precedence regressions, correction authorization/conflict/concurrency and grade preservation tests.
- [x] Inline correction UI, bilingual action/error text, and real browser grading/correction flows.
- [ ] Follow-up PR exact-head CI/admin merge; production remains on hold.

Local correction validation passed: `pnpm ci:verify` (341 unit files / 2,933 tests, 25 component files / 49 tests, build/lint/typechecks); 48 real-DB roster/grading tests; 12 Playwright membership, activation, and grading/correction cases without retries. Independent review found no P1/P2 issues. The initial correction preservation assertion was corrected to permit the membership's normal `updatedAt` change; the initial browser conflict test was corrected to locate by stable membership ID while the username is being edited. Final runs pass with those fixes.

## Migration and deployment

The user authorized local validation and an admin PR merge on 2026-09-07. Production release, production DB migration, and placeholder deletion are explicitly on hold until a later user instruction. Merging main does not authorize a version tag or a deploy-branch update.

Use the existing Helm/Flux maintenance sequence; do not create a parallel deploy path. Confirm backup recoverability and exact primary/database identity; inventory IDs and all references. Drain web and both workers plus autoscalers before any incompatible schema/data write. In a single PostgreSQL transaction, add and backfill the new subjects, detach placeholder Users to pendingUsername while preserving membership IDs and all attributes, validate data, and delete only the inventoried still-pending Users. Unexpected references fail closed. Drop User.status/UserStatus and retired placeholder machinery. Keep legacy migrations as production history, with a new forward-only contract migration.

Add a course-roster schema-contract label to all three workloads and the existing admission fence. After contract commit, failure stays in maintenance and requires a compatible forward fix. Verify new workloads, public release/readiness, zero placeholder Users, preserved roster/roles, and unaffected real users. Do not run tests against production.

## Acceptance

- All three canonical school formats plus generic username enrollment and automatic student/TA binding.
- Pending assignment/exam grading and feedback, timing/role/mode gates, later ownership visibility without fabricated participation.
- School merge 80 versus 90 yields 90; nonconflicting scores, real submissions, and both audit histories remain; exactly one membership remains.
- Concurrent bulk-add/signup/verification, repeated tokens/logins, rollback injection, removed memberships, rename/reuse, and account deletion.
- Staff rows/search/sort/CSV/counts include pending members; students cannot read others' grades; notifications contain no null IDs.
- Rehearse 8-placeholder migration plus scored/removed/audited variants, unexpected-reference refusal, full transaction rollback, and repeat deployment.
- Relevant unit, integration, component, E2E tests; ci:verify; migration drift; Helm and maintenance contract checks; independent spec/quality review; exact-head CI before release.

## Validation record

Implementation worktree starts from origin/main `0c18c9cb`; the user's main checkout and its unrelated edits remain untouched. The 2026-09-07 production audit found 97 Users (89 real, 8 pending), 65 memberships, no memberships without usernames, and no manual grading/feedback rows or audit rows. These counts are not an execution-time deletion whitelist.

### Implementation verification in progress

- Isolated implementation now includes roster-based grades/feedback, common identity linking/merge, reserved-username protection, UI/API DTOs, migration/fence, and seed/docs changes. The former synthetic actor creation path is removed; authenticated mutations require an existing User.
- `pnpm ci:verify` passed: build (12 tasks), typecheck (20 tasks), lint (12 tasks), both test typechecks, 340 unit files / 2,928 tests, and 25 component files / 48 tests. Helm lint passed. Independent review found and resolved a first-submission/delete race (User row lock before blocker counts), username/grading lock inversion (bind/course locks before username update), and removed-staff read access (both course access repositories return active memberships only). SQL/maintenance review reported no P1/P2 findings. Identity recheck reported both concurrency fixes resolved; removed-staff access recheck also passed. The six deterministic concurrency regressions and three removed-staff DB cases subsequently passed in the complete integration run below.
- The user granted fresh consent for local validation after Prisma's AI safety guard rejected test setup `prisma db push --accept-data-loss`. Supply that exact consent through Prisma's supported environment variable; retain the loopback, allowlisted database name, and live database marker checks for `nojv_test` and `nojv_e2e_test`.
- The complete local integration suite passed: 84 files / 643 tests, including real PostgreSQL, Redis, Temporal, and Docker judge cases. Roster merge/concurrency/deletion/access tests and all 16 migration scenarios passed. The first DB rehearsal exposed a temporary-table dependency on the retired UserStatus enum; dropping the consumed snapshot before dropping the enum resolved it. No rollback or unexpected-reference rejection was weakened.
- Integrated origin/main `a542f98f` member-table and filter updates, retaining membership IDs and pending identity semantics. Added roster activation and pre-activation grading flows to the existing CI browser smoke job. Merged UI typecheck has zero errors and warnings. The complete merged-tree ci:verify run passed with the same 2,928 unit and 48 component tests.
- Unchanged `prisma migrate deploy` passed against an empty local database and the restored pre-contract backup, with schema diff=0 and a no-change second deploy. The original snapshot retained all 65 memberships, all 89 real Users, and every unaffected table row, while detaching exactly eight pending Users. A second restored variant also preserved three manual scores, two feedback records, five score audits, and four feedback audits.
- Live restore exposed an existing storage-map validator lookup bug under pg_restore's empty search_path. The new forward migration qualifies its helper reference; historical archives use the documented staged restore without disabling CHECKs. A new dump of the upgraded database then passed ordinary pg_dump/pg_restore with no workaround and exact preservation of all table rows. The 18 roster/storage migration regressions passed after this fix.
- All 38 relevant Playwright cases passed in one run without retries: member table/filter management, all three school formats and general names, pending assignment/exam scores and feedback, CSV, first username activation retaining User/membership identity and grades, authentication, account editing, exam access, and rejudge/override APIs. New tests wait for the existing hydrated account-menu control before client-only actions. The final restore-fix increment received independent review with no P1/P2 findings.
- Integrated subsequent origin/main `743aab92` role-dropdown, avatar, and exam-tab updates. Final local ci:verify passed: 341 unit files / 2,933 tests and 25 component files / 49 tests, with build/typecheck/lint clean. The 39 affected DB cases passed again; all 25 affected browser cases passed without retries, including pending-role menus, avatar-compatible DTOs, exam tab refresh, and cancelled/failed menu actions.
- Refreshed production read-only counts remain 89 real accounts and eight pending accounts / eight memberships (seven students and one TA), with zero manual grades, feedback, or grading audit rows. All 44 User foreign keys were rechecked; the only nonzero placeholder references are eight CourseMembership.userId rows. Primary `nojv-pg-1`, database `nojv`, 17 MB. No CNPG Backup or namespace CronJob resources were found; a restricted custom-format dump was captured off-host and fully decoded successfully. The subsequent live local restore and upgraded archive round trip passed, as recorded above. Backup SHA-256: `0863d7adda90445f4ffa7c3dce85a6c99118876945c339589d7c20a007233937`.
- Remote CI and the authorized admin merge are the next delivery step. No release, production schema conversion, or placeholder deletions have occurred. Leave this plan active until all deployment acceptance checks pass.

### Remaining delivery steps

1. Require all remote CI jobs for the final PR head, then perform the explicitly authorized admin merge and verify its commit on main. Stop before version tagging, image publication, deploy-branch updates, or production writes.
2. Only after a later production instruction, refresh production primary, backup, candidate IDs and all FK references immediately before maintenance; preserve memberships, apply the atomic conversion, verify counts/roles and real-user integrity, then validate workload images and public release/readiness. No standalone live `DELETE` shortcut.
