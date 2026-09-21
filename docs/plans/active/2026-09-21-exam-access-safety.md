# Exam access and interaction safety

**Goal:** investigate stale judging and IP reports, add exam-scoped username/password access, and make exam management and hand-in safer.

**Architecture:** keep Better Auth sessions and the existing course/exam permissions. Store independent, expiring exam credentials; use the existing durable-work processor to reconcile issuance and delivery. Keep credential mail out of generic notification payloads and send only to the account security email.

**Dependencies:** [Exams](../../specs/exams.md), [Security](../../operations/SECURITY.md), [Architecture](../../architecture/ARCHITECTURE.md), [Design](../../architecture/DESIGN.md), [Testing](../../runbooks/testing.md).

## Evidence before implementation

- Investigation base: freshly fetched `origin/main` at `8a654f34533b4ec47ca69a5001c08ff038a54552`. The implementation was subsequently rebased onto `dd6c27de` for final verification.
- Submission fix #473 is merged: terminal `system_error` without result detail previously kept the browser waiting. The new tracker terminates by status and the server returns a DB-derived terminal summary.
- Live release readback during investigation reported v1.1.21 / `f81b0bc0ebb532be3766e66b05d3599dff6030c7`; this predates #473. A merged fix is not deployment proof.
- IP reset fix #462 is merged: reset is reachable from violations even without an active session. `notify` mode deliberately does not block; reset currently exempts both whitelist and binding for ten minutes.
- Workspace hand-in is a small destructive button beside the countdown and problem navigation. Its native confirmation exists, but location still invites accidental clicks.

## Decisions

- Issue one credential per published exam and active, bound student course membership at start minus 24 hours. Reconcile late publication and late enrollment. Pending roster usernames have no account mailbox and must display an actionable unavailable status.
- Keep the original OAuth and administrator passwords intact. Authentication accepts username plus a currently valid exam password and creates a Better Auth session associated with that credential revision.
- Access behavior: normal course access before entering the exam; existing confinement after entry; credential and password-derived sessions invalid after the exam hard end. Other login sessions remain independent.
- Managers are active course teachers/TAs or effective administrators. Only this permission exposes or changes credentials. Do not include plaintext passwords in logs, audit metadata, durable job payloads, or student page data.
- Preserve the current visual system. Use the same outlined large button for password and OAuth login, group exam management functions, and put settings last.
- Move hand-in from the workspace timer to the exam overview, with a separate confirmation dialog whose safe initial focus is cancel.

## Work and verification

1. Domain, repository and schema: credential lifecycle, recoverable encrypted password plus verification hash, session association, roster DTO, teacher/TA password update, durable delivery and expiry. Cover time boundaries, revisions, wrong password, role/membership gates, missed schedules, suppressed delivery and duplicate processing.
2. Authentication: Better Auth custom endpoint, strict rate limiting, session validity and denial of permanent credential/security changes from temporary sessions. Cover invalid/expired login and existing OAuth behavior.
3. Interface: login form, credentials management, reduced primary tabs/settings last, separate hand-in interaction. Verify component behavior, bilingual copy, keyboard interaction and responsive layout.
4. Integrate, generate schema/docs, run focused tests, type checks and repository checks. Run real local integration/E2E where available; report any unavailable evidence explicitly.

## Investigation findings

- [Submission tracking #473](https://github.com/NOJV-TW/NOJV/pull/473) addresses the terminal-SE-without-result path. [Execution recovery #471](https://github.com/NOJV-TW/NOJV/pull/471) also distinguishes terminal results from an execution that is still recovering. A displayed legacy SE during recovery is not by itself proof of stale client state. The public release endpoint still reports the earlier `f81b0bc0` build during local verification.
- [IP reset #462](https://github.com/NOJV-TW/NOJV/pull/462) adds a reset entry for recorded violations when there is no active exam session. This change also puts reset on the full student roster, so staff no longer depend on the bounded violation history to reach it.
- IP gates enforce the configured whitelist and bound public IP in blocking modes; `notify` records violations without blocking. Reset grants a ten-minute exemption from both checks. Students behind the same NAT share the public IP, so binding does not identify an individual device.
- Remaining code-level leads, outside this implementation: initial IP binding uses a read/write sequence without compare-and-set; exam entry creates the active session before applying the gate; reset without an active session has no session audit row; a violation written inside a rejected submission transaction rolls back. These observations require targeted follow-up and do not identify the cause of an unspecified historical report.

## Local acceptance evidence

- Full `pnpm ci:verify` passed after rebasing: formatting/guards, build, type checks, lint, 386 unit files with 3,613 tests, and 39 component files with 92 tests.
- Database and HTTP integration: five files, 50 tests passed, covering issuance, expiry, rotation, delivery state, rescheduling, temporary-session restrictions, OAuth identity, IP reset and classroom login limits. Mail delivery used the sink or test adapter; SMTP was not exercised.
- Security review found and corrected a classroom-NAT issue: exam password attempts now use a normalized username plus IP quota of five per fifteen minutes. Existing shared-IP limits remain: 60 authentication requests per minute and 20 form actions per minute. Malformed usernames share one invalid-input bucket; Redis failures reject authentication.
- Actual local app: 13 checks passed using unique synthetic fixtures in the marked `nojv_e2e_test` database. Teacher password setting and rotation, old-password rejection, successful student login, denied security mutations, tab order, responsive fit and cancel/confirm hand-in persistence were exercised. No browser runtime exceptions were observed; development-console Svelte warnings remain.
- Visual review: real components checked at 1440 and 390 pixels in both themes. The detector reported no findings. The incorrect English hand-in instruction was corrected to point to each problem's submission history.
- The standard Playwright bootstrap was blocked by Prisma's automatic safety review because it requests `db push --force-reset`. No reset or override was performed. The actual-app checks instead used additive synthetic fixtures; their results are separate from the unexecuted standard E2E suite.
- Screenshots and local verification logs are stored under `output/exam-access-safety/` and excluded from Git.

## Delivery boundary

No production credential issuance, email, migration or deployment is part of local verification. Keep this plan active until shipped. Investigation findings do not establish the cause of an unidentified historical incident without its timestamp and submission/exam identifiers.
