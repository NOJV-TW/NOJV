# Course roster independent of authentication

## Goal and accepted decisions

Replace placeholder Users with durable CourseMembership rows. Teachers can enroll and grade students before account creation. Preserve the eight production placeholders' eight memberships (seven students, one TA, two courses), then delete only those placeholder Users during the verified maintenance release. The inventory is a read-only snapshot and must be refreshed before writes.

- NTNU uses the bare student ID; NTU uses `ntu_`; NTUST uses `ntust_`. Teachers enter the full username. Do not add or guess prefixes.
- General usernames are supported: teacher entry authorizes eventual matching account ownership, including TA roles. No invitation or additional approval workflow.
- Assignment and exam manual scores and feedback work before activation. Keep existing timing and scoring-mode rules; do not fabricate participation or submission rows.
- School verification updates the existing User's username, preserving its ID, credentials, and submissions.
- On same-course collisions, the school roster row survives and its conflicting manual scores, feedback, role, and status win. Merge nonconflicting data and preserve both histories. General renames instead preserve the already-linked row and its conflicting data/role/status.
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

- [ ] Model, atomic membership binding/merge, identity entrypoints, and real-DB tests.
- [ ] Course grading/feedback APIs, scoring, query/DTO updates, and tests.
- [ ] Members/gradebook/matrix UI, translations, CSV, and browser tests.
- [ ] Atomic production migration, guarded cleanup, schema rollback fence, seed/docs cleanup, and migration rehearsal.
- [ ] Full local checks, independent review, CI, release, production data and workload verification.

## Migration and deployment

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
- `pnpm ci:verify` passed: build (12 tasks), typecheck (20 tasks), lint (12 tasks), both test typechecks, 340 unit files / 2,928 tests, and 25 component files / 48 tests. Helm lint passed. Independent review found and resolved a first-submission/delete race (User row lock before blocker counts), username/grading lock inversion (bind/course locks before username update), and removed-staff read access (both course access repositories return active memberships only). SQL/maintenance review reported no P1/P2 findings. Identity recheck reported both concurrency fixes resolved; removed-staff access recheck also passed. Six deterministic concurrency regressions and three removed-staff DB cases were authored; execution remains pending. These results do not cover real-DB migrations, integration, or browser flows.
- Real-DB integration and browser runs are paused: Prisma's AI safety guard rejected test setup `prisma db push --accept-data-loss` and requested fresh explicit user consent. The rejected connection was the safety-marked local `nojv_test` database, never production. Do not bypass the guard or claim these tests ran.
- Refreshed production read-only counts remain 89 real accounts and eight pending accounts / eight memberships (seven students and one TA), with zero manual grades, feedback, or grading audit rows. All 44 User foreign keys were rechecked; the only nonzero placeholder references are eight CourseMembership.userId rows. Primary `nojv-pg-1`, database `nojv`, 17 MB. No CNPG Backup or namespace CronJob resources were found; a restricted custom-format dump was captured off-host and fully decoded successfully. A live restore rehearsal remains pending. Backup SHA-256: `0863d7adda90445f4ffa7c3dce85a6c99118876945c339589d7c20a007233937`.
- No remote CI, release, production schema conversion, or placeholder deletions have occurred yet. Leave this plan active until all deployment acceptance checks pass.

### Next required validation steps

After explicit consent for the two local destructive test databases:

1. Run roster binding/merge/removal/deletion regressions, grading/feedback API and domain tests, security-generation tests, and full historical migration rehearsal in `nojv_test`; then the complete relevant integration suite.
2. Exercise unchanged `prisma migrate deploy` transaction/index behavior and schema drift against an empty test database and a restored pre-contract snapshot. The existing isolated-schema rehearsal deliberately strips `CONCURRENTLY` and controls transaction boundaries; it does not replace this check. Verify the off-host dump by a live local restore before relying on it for production.
3. Run Playwright course-roster, course-roster-activation, course-members-settings, grading/feedback, and account onboarding/verification flows in `nojv_e2e_test`; inspect rendered pending rows and linked-student views.
4. Finish fresh local `ci:verify`, independent review, exact-head remote CI and the normal review gate. Publish with the existing Helm/Flux release pipeline only after these pass.
5. Refresh production primary, backup, candidate IDs and all FK references immediately before maintenance; preserve memberships, apply the atomic conversion, verify counts/roles and real-user integrity, then validate workload images and public release/readiness. No standalone live `DELETE` shortcut.
