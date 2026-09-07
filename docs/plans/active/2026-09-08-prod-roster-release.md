# Production roster release verification

The user authorized production migration and deployment on 2026-09-08 after a complete review and successful data-transfer rehearsal. Follow [Deployment](../../operations/DEPLOYMENT.md) and [Backup & Restore](../../runbooks/backup-restore.md).

The user selected `v1.1.0` as the release tag. Create it only at the verified post-merge main commit.

This isolated worktree owns the problem-library/permissions implementation, the combined roster and problem-weight verification, and the production release. Deployment and database migration stay with the current task. This file is an active checkpoint, not a completed release report.

## Scope

- Review the complete release delta from production v1.0.4 (`efe425b772a1ffea75986db67dcabcc85d8ae965`).
- Deploy the merged roster/account separation, membership correction, authentication, table/editor, exam finality and late-submission changes after verification.
- PR #421 supplied the accepted design. This implementation adds the formal CourseProblem migration and application flows; its historical candidate SQL is not the release migration.
- Exclude draft PR #419, which explicitly requires an unpublished upstream WASM runtime.
- Preserve the user's unrelated checkout changes in an isolated worktree.

## Gates

- [x] Independent review of all pending migrations, identity/grading flows, and other release changes.
- [ ] Fresh primary identity and reference inventory; private, checksummed backup outside the repository.
- [x] Local restore and official migration rehearsal: exact expected records, unchanged unrelated rows, constraints, rerun, ordinary upgraded backup restore.
- [x] Current release code passes local CI, real database integration, affected browser flows, and Helm maintenance checks.
- [ ] Exact post-merge main SHA passes GitHub Verify Repository before tagging.
- [ ] Immutable images built; stop web and both workers with autoscalers held, obtain and verify a new cutover backup before allowing the migration.
- [ ] Apply through Helm/Flux; failures after schema commit remain in maintenance for a compatible forward fix.
- [ ] Verify migrated rows and all unaffected records against cutover evidence; confirm schema and migration history.
- [ ] Verify exact source/image revisions, all workloads, public endpoints, authenticated primary workflows, object reads, judging and stability.

Production mutations remain gated on the preceding review and rehearsal results. Sensitive snapshots and credentials never belong in this plan or a PR.

## Verification checkpoints

- PR #421 merged as `b8fc617673a8d716a8f95d52128844e26488b890` after current required checks passed. No CourseProblem implementation was added here.
- Fresh production read-only inventory: 99 users, 9 pending accounts, 68 memberships, 227 submissions, zero live score overrides and feedback, zero failed migrations. Prior eight-placeholder snapshots are stale.
- The private preflight backup passed the full official migration sequence, with exact comparisons of all retained records and independently calculated roster, late-policy, decimal-weight and course-library changes. Actual result: nine pending accounts removed, nine memberships detached, 68 memberships and 227 submissions retained, 90 formal users preserved. Schema diff is zero; reruns and upgraded archive restore preserve records and migration history. This is not a future stopped-write cutover backup.
- Synthetic scored/audited/removed-member cases and 14 targeted rollback failures passed. Root SQL diagnostics are checked separately because Prisma can mask transactional errors; timestamps use independent database clock bounds.
- Integrated weights PR #422 and role-preservation tests #423 from main `60d60176f91cae856412ef0008fb3c2fac5912df`. The independent review's confinement, transactional workspace read, ownership-lock and private-draft-copy findings were repaired and have regression checks.
- Final local CI passes 3,107 unit and 55 component tests, including the reviewed fixes. Full integration passes 689 tests; 22 focused database checks separately confirm the final confinement, workspace-copy and private-draft-copy fixes. Browser validation runs after builds complete because rebuilding package outputs invalidates a running Vite test server.
- Browser review found and fixed premature exam settings rendering during tab navigation, which could reset edits when the server load completed. Course-library import/reuse/removal and archived full-content navigation, roster activation, activity weights, problem lifecycle and late-policy flows pass. All 28 selected browser checks pass across the final run and targeted rerun: MFA, passkeys, regular/super-admin sign-in, admin filters, roster, library, weights and late policy. The additional eight problem lifecycle checks passed earlier. Admin filter tests now wait for hydration and scope actions to the open dialog.
- No production writes, maintenance switch, tag publication, Flux suspension or migration occurred in this task.
