# Decision log

Durable decisions for NOJV, grouped by area. Each entry records what was decided, why, what was rejected, and the rules future work must respect. Living docs describe how the system works now; this log explains why it is that way.

## How to use it

- Before brainstorming or planning, scan this index and read the full entries for every area your change touches.
- A design that contradicts an entry must say so and update or replace the entry in the same PR, keeping the old choice as a `Rejected:` line.
- New entries use the next free ID in their file and link the PR as `Source:`. IDs are never reused; this index must list every entry (checked by `tests/unit/docs/doc-links.test.ts`).
- Original plan documents are preserved in git history at `f0347eb`; each entry links the plans it came from.

## [Judge and sandbox](judge.md)

- JDG-01 Fixed Standard Mode with three exclusive judge types
- JDG-02 Standard compare is DOMjudge token comparison with two knobs
- JDG-03 DOMjudge validator protocol for checkers and interactors, AC/WA only
- JDG-04 Subtasks score all-or-nothing in every context
- JDG-05 Run/check separation: untrusted code never sees answers or validators
- JDG-06 One sandbox per stage; per-process accounting via nojv-exec
- JDG-07 Per-language time factor applied once
- JDG-08 Memory ceiling above the problem limit; admission rejections are terminal
- JDG-09 Platform failures are system_error, explicit and bounded
- JDG-10 Durable execution snapshots; rejudge in place with audit log
- JDG-11 SE recovery is bounded and generation-guarded
- JDG-12 Judge queue is Temporal priority and fairness, not a coordinator
- JDG-13 Load-aware judge slots via Temporal's resource-based tuner
- JDG-14 One canonical toolchain manifest with exact pins
- JDG-15 Browser Test runs locally in WASM-OJ; official verdicts stay on the server
- JDG-16 Advanced Mode is a platform-orchestrated run/grade split
- JDG-17 Advanced network is none or service; answer-bearing containers have no egress
- JDG-18 sandbox-runner depends only on core
- JDG-19 Hardened Docker args come from one builder and one package
- JDG-20 Production K8s judging fails closed; infrastructure faults retry
- JDG-21 10 MiB testcases via sharded, hash-verified payloads
- JDG-22 Sandbox cleanup is UID-fenced and durable

## [Problems and submissions](problems.md)

- PRB-01 Three problem types; workspace files instead of templates
- PRB-02 Judge settings live in one validated `judgeConfig` JSON column
- PRB-03 Samples are presentation data, not testcases
- PRB-04 Testcase and workspace content live in object storage behind versioned pointers
- PRB-05 Problem images are public objects referenced from Markdown
- PRB-06 Author uploads have a per-problem budget and safe bundle import
- PRB-07 `displayId` is for display only; URLs keep the cuid
- PRB-08 Draft lifecycle and server-enforced publish/delete guards
- PRB-09 Publication requires a private, current reference solution
- PRB-10 Personal ownership, course sharing and forks
- PRB-11 Visibility, public publication and admin consent
- PRB-12 special_env uses teacher-built, digest-pinned images in `advancedConfig`
- PRB-13 special_env required paths are static literals
- PRB-14 Problem library search and filters
- PRB-15 Submission creation commits an outbox row, then dispatches immediately
- PRB-16 Stuck submissions sweep to `system_error`, which never costs an attempt
- PRB-17 Operation authority follows the submission's context
- PRB-18 Rejudge logs are summaries, idempotent per run, kept 90 days
- PRB-19 One case-result schema and one verdict style source
- PRB-20 Closed activities become practice without touching grades
- PRB-21 Status and judge generation drive submission tracking

## [Courses, contests, exams and scoring](assessments.md)

- ASM-01 Course exams and standalone contests are separate entities
- ASM-02 One course UI for every role
- ASM-03 Enrollment is teacher-driven bulk handle paste only
- ASM-04 Roster rows are durable memberships independent of user accounts
- ASM-05 TAs may remove students only
- ASM-06 Contest management is owner-or-admin through one pure primitive
- ASM-07 Contest problems are withheld from non-managers until start
- ASM-08 ICPC penalty counts only judged wrong attempts; penalty minutes per contest
- ASM-09 Upsolve, virtual contests and class analytics derive from existing data
- ASM-10 One clarification board for contests, exams and assignments
- ASM-11 Clarifications are private until answered publicly, askers are anonymous to non-staff, and only the first answer notifies
- ASM-12 Late policy: activity-level due date, hard close, flat or daily penalty
- ASM-13 Attempt limits are per problem per daily window; rejudges are controllable
- ASM-14 Assessment lifecycle audit outlives the assessment; timeline reads existing logs
- ASM-15 Timed-context scoring is shared pure code behind one orchestrator
- ASM-16 Raw problem scores and activity point allocation are separate
- ASM-17 Score overrides are per membership, reasoned, audited, and never for contests
- ASM-18 Grading happens after close; feedback is its own table
- ASM-19 Exam confinement is a server-side session lock enforced in the global hook
- ASM-20 Exam IP rules: whitelist and first-binding, gated on every request, fail closed
- ASM-21 Exam submissions are scoped to the exam and final after hand-in
- ASM-22 Exam-scoped expiring passwords as an extra login path
- ASM-23 Plagiarism detection runs Dolos in-process in the worker
- ASM-24 Plagiarism results are curatable and re-runs leave a receipt
- ASM-25 Course management authority is one active-membership check; ownership is not a grant

## [Authentication and security](security.md)

- SEC-01 Third-party login only; no public sign-up; admins bootstrapped from env
- SEC-02 Provider accounts are the login identity; linking is explicit; `User.email` is the security mailbox
- SEC-03 `User.username` is the only handle; only school verification assigns a student ID
- SEC-04 Step-up uses an enrolled factor; MFA state derives from factors
- SEC-05 Admin privilege starts only at explicit elevation; super admins have a stricter login
- SEC-06 Admin hierarchy is server-enforced, deliberate and audited
- SEC-07 API tokens: hashed bearer secrets gated by whitelist, scope and owner role
- SEC-08 API token management requires fresh step-up on every action
- SEC-09 Client IP comes only from the trusted edge
- SEC-10 Markdown trust is nonce-based; body limits count streamed bytes
- SEC-11 Third-party Markdown images go through a same-origin SSRF-safe proxy
- SEC-12 Graded testcase data never reaches non-staff
- SEC-13 Rejudge control accepts only rejudge workflows owned by the caller or an admin
- SEC-14 Advanced-mode `/output` capture never dereferences student paths

## [Web application](web.md)

- WEB-01 Top-level detail and solve routes, layout-enforced gates
- WEB-02 Every form failure is visible through typed messages and one action wrapper
- WEB-03 Fail loudly on corrupt data; validate every persisted blob on read
- WEB-04 Durable notifications are separate from toasts
- WEB-05 The server holds the code draft of record, keyed by context, problem and language
- WEB-06 Activity heatmap, streak and trend are bucketed client-side in local time
- WEB-07 Public profiles are opt-in and hidden ones 404
- WEB-08 Admin mode routes content navigation to the global admin lists

## [Product and UI](product-ui.md)

- UI-01 DOMjudge semantics without ICPC contest control
- UI-02 Public problem publishing stays owner-driven
- UI-03 Email is an opt-out channel on top of in-site notifications
- UI-04 Editorials and discussions are one problem-post model with moderated reports
- UI-05 Problem posts are gated server-side by active context and AC
- UI-06 Posts live in the problem workspace panel
- UI-07 All UI text ships in en and zh-TW through Paraglide
- UI-08 One site-level locale switcher; locale-bound date formatting
- UI-09 Pages use three layout archetypes: Index, Hub, Workspace
- UI-10 Top-level list pages share a header and `?tab=` tab row
- UI-11 Share a component only when content converges, not shape
- UI-12 Table filters and row editors use Bits UI, not native selects
- UI-13 Mobile is read-only; no solving workspace below `md`
- UI-14 Solve pages fill the viewport; motion stays restrained
- UI-15 The problem editor follows the author's mental model
- UI-16 Activity problems are chosen in one explicit multi-select dialog
- UI-17 Assessment management shares one tab set; hand-in lives on the exam overview
- UI-18 Submission IDs appear only in detail views
- UI-19 The personal dashboard is an ability overview, not an aggregator
- UI-20 Home shows every visible item in equal-height scroll panels
- UI-21 About and legal pages are public and reached from the footer
- UI-22 Onboarding tours: one engine, role registries, server-side seen state

## [Data, cache and workflows](data.md)

- DAT-01 Data access goes through `@nojv/db` repositories
- DAT-02 Entities are identified by cuid only; no slugs
- DAT-03 Submission stays one flat table with per-context FKs and a CHECK
- DAT-04 One `Participation` table for contest, exam and virtual
- DAT-05 Activity config stays inline per activity table
- DAT-06 File bodies live in object storage, never in Postgres
- DAT-07 Users with graded history are anonymized, not deleted
- DAT-08 Grading audit history survives membership merges
- DAT-09 Redis keys and channels live in one registry
- DAT-10 Redis holds only state rebuildable from Postgres
- DAT-11 Scoreboards are built from Postgres; Redis only nudges
- DAT-12 Redis-backed rate limits fail closed fast
- DAT-13 Temporal runs all async orchestration
- DAT-14 Temporal stays behind an orchestration port
- DAT-15 Workflow code changes are versioned with `patched()`
- DAT-16 Workflow inputs carry ids, not blobs
- DAT-17 Batch rejudge isolates child failures and keeps cancellation
- DAT-18 Reminders are lead-day checkpoints with dedupe keys
- DAT-19 Cron processors are a cron parent awaiting a continue-as-new child

## [Platform and operations](platform.md)

- OPS-01 The Helm chart is the only deploy path
- OPS-02 Production deploys by in-cluster pull (Flux)
- OPS-03 Flux tracks a CI-written `deploy` branch as one atomic artifact
- OPS-04 Releases come only from `vX.Y.Z` tags on verified main commits
- OPS-05 Incompatible schema cutovers stop writers and forward-fix
- OPS-06 Production requires verified off-host backups
- OPS-07 GitOps must never be able to delete stateful data
- OPS-08 The origin is reachable only through Cloudflare
- OPS-09 Temporal stays self-hosted
- OPS-10 Teacher judge images use a self-hosted, namespace-scoped registry
- OPS-11 Sandbox ResourceQuota is the judge capacity ceiling
- OPS-12 Operational tunables are env vars wired through Helm
- OPS-13 CI enforces security scans, a coverage ratchet and schema-doc drift
- OPS-14 Metrics stay in-cluster with bounded cardinality, and the in-cluster Grafana alerts
- OPS-15 Web readiness depends only on Postgres and Redis
- OPS-16 Release notification belongs to the external status Worker
- OPS-17 Email is durable work over a generic SMTP mailer
- OPS-18 Renovate is the only dependency update bot

## [Engineering practice](engineering.md)

- ENG-01 Living docs have one purpose each and describe only shipped behavior
- ENG-02 Strict top-down layers with business logic in `@nojv/application`, enforced by lint
- ENG-03 Config and registration surfaces get executable fitness tests
- ENG-04 HTTP routes are tested through an in-process SvelteKit harness
- ENG-05 The HTTP API is documented, not duplicated
- ENG-06 Audit findings are re-verified against code before acting
- ENG-07 Cleanups keep the app/package layers and behavior
