# NOJV Platform Development Roadmap

## Objective

Turn the current POC into a production-ready Online Judge with secure execution, contest operations, and evidence-driven anti-cheat workflows.

## Current Baseline

- Problem detail pages already provide an in-browser Monaco editor.
- Workspace runs already ship file payloads and commands through BullMQ to the worker.
- Contest pages already exist as a separate product zone.
- Integrity telemetry already produces reviewer-oriented risk assessments.

## Phase 1: Delivery Hardening

- Keep local and CI verification aligned around one root command.
- Add smoke tests for queue-backed APIs and browser-level POC flows.
- Document environment variables, process layout, and operational runbooks.
- Add seed data and one-command local startup for reviewers and instructors.

## Phase 2: Judge Execution Core

- Introduce a real sandbox execution service instead of placeholder worker returns.
- Define job lifecycle for compile, run, diff, score, and artifact persistence.
- Support per-language execution images and assignment-grade command execution.
- Persist structured verdicts, compiler logs, runtime metrics, and artifacts.

## Phase 3: Auth, Roles, And Problem Authoring

- Add authentication and session management.
- Introduce role boundaries for admin, instructor, reviewer, and contestant.
- Build problem authoring for statements, localized content, test sets, and limits.
- Add admin-facing CRUD for contests, assignments, and execution policies.

## Phase 4: Contest Engine

- Implement contest registration, participation lifecycle, and score aggregation.
- Add frozen scoreboard rules, penalty logic, and contest-specific access control.
- Bind contest workspaces and submissions to participation context.
- Add contest telemetry capture with higher-integrity thresholds.

## Phase 5: Anti-Cheat Evidence System

- Collect client-side signals such as focus loss, paste bursts, and visibility shifts.
- Add IP, device, and concurrent-session signals.
- Implement normalized-code similarity analysis and reviewer case aggregation.
- Build reviewer workflows for triage, escalation, resolution, and audit trails.

## Phase 6: GCP Delivery

- Create production-grade Cloud Run deployment pipelines.
- Provision Cloud SQL, Memorystore, Artifact Registry, Secret Manager, and Storage.
- Add environment promotion strategy for preview, staging, and production.
- Add runtime observability for queue depth, failed jobs, and execution latency.

## Exit Criteria

- Every phase ends with explicit verification commands and deployable artifacts.
- No feature enters the platform without schema contracts, operational ownership, and documentation.
- The execution plane remains outside the web tier at all times.
