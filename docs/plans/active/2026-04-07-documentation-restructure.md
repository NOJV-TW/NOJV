# Documentation Restructure Plan

**Date:** 2026-04-07
**Status:** Approved
**Reference:** https://github.com/nycu-life/nycu-life-lgtm/tree/main/docs

## Goals

1. Every doc has a single clear responsibility with no content overlap
2. `AGENT.md` is the AI agent entrypoint; `CLAUDE.md` is a thin symlink
3. Add missing docs: `THREAT_MODEL.md`, `DESIGN.md`, `PRODUCT_SENSE.md`, `QUALITY_SCORE.md`, `PLANS.md`
4. `SECURITY.md` becomes handling rules only; attack-surface analysis moves to `THREAT_MODEL.md`
5. All docs describe shipped reality, not aspirational features
6. All docs are in English

## Target Structure

```
CLAUDE.md                   → thin link to AGENT.md
AGENT.md                    → navigation entrypoint (reading order, quick ref, repo layout, rules)
ARCHITECTURE.md             → tiers, packages, dependency graph, runtime entries (no auth/permission detail)

docs/
├── FRONTEND.md             → route map, component contracts, runtime boundaries, validation
├── DESIGN.md               → NEW: implemented design system, interaction patterns, change rules
├── PRODUCT_SENSE.md        → NEW: users/outcomes, shipped scope, tradeoff rules, non-goals
├── QUALITY_SCORE.md        → NEW: per-area grades, evidence, next upgrade, doc drift
├── PLANS.md                → NEW: planning system (active/completed plan locations, naming, lifecycle)
├── DATABASE.md             → schema, domain model, enums (minor cleanup)
├── TEMPORAL.md             → workflows, activities (unchanged)
├── JUDGE_PIPELINE.md       → pipeline stages (unchanged)
├── REDIS.md                → key patterns, pub/sub (unchanged)
├── SECURITY.md             → REWRITE: sensitive data, handling rules, review expectations
├── THREAT_MODEL.md         → NEW: assets, trust boundaries, attack surfaces, mitigations, criticality
├── RELIABILITY.md          → service expectations, failure modes, invariants (minor cleanup)
├── DEPLOYMENT.md           → docker compose, env vars, GCP, CI/CD (already updated)
├── plans/                  → design docs (renamed from implicit)
│   ├── active/             → NEW: active execution plans
│   └── completed/          → NEW: completed plans
└── runbooks/               → operational runbooks (unchanged)
```

## File-by-File Changes

### CREATE: `AGENT.md`

Content migrated from current `CLAUDE.md`:
- Reading order (updated to include new docs)
- Quick reference (one-liner per technology)
- Common commands
- Repository layout
- Rules section

Reading order update:
1. Architecture Overview
2. Product Sense
3. Frontend Surface
4. Design Rules
5. Temporal Workflows
6. Judge Pipeline
7. Database Schema
8. Redis Architecture
9. Security Requirements
10. Threat Model
11. Reliability Invariants
12. Deployment Guide
13. Quality Ledger
14. Planning System
15. Getting Started Runbook

### REWRITE: `CLAUDE.md`

Becomes:
```markdown
# AGENTS.md

This file is the agent entrypoint for this repository. Read it first, then follow the linked
living documents instead of treating `README.md` as the full source of truth.

(full content here — see AGENT.md section above)
```

And `CLAUDE.md` becomes a thin redirect:
```markdown
See [AGENT.md](AGENT.md).
```

Wait — actually the reference repo puts the real content in CLAUDE.md with the AGENTS.md title. Let me follow the same pattern: `CLAUDE.md` contains the full navigation content (titled `# AGENTS.md`), no separate AGENT.md file needed. This way all AI tools (Claude, Cursor, Copilot) find it via their respective entrypoint filenames.

**Revised approach:**
- `CLAUDE.md` — full navigation content (titled `# AGENTS.md`)
- No separate `AGENT.md` file (avoids duplication)

### REWRITE: `ARCHITECTURE.md`

Remove:
- Authentication & Authorization section (→ `SECURITY.md`)
- Validation section (→ `SECURITY.md` handling rules)
- Internationalization section (→ `FRONTEND.md`)
- Real-Time Events section (→ `FRONTEND.md`)

Keep and tighten:
- Multi-tier diagram
- System domains table
- Package structure + dependency graph + dependency rules
- Runtime entry points
- Shared package descriptions

### CREATE: `docs/DESIGN.md`

Sections:
- Implemented design system: Tailwind CSS 4, Manrope/JetBrains Mono/Fraunces fonts, color tokens
- Component grammar: cards, tabs, badges, Monaco editor, markdown renderer
- Interaction patterns: problem workspace split-pane, contest timers, form validation feedback
- Action safety: destructive actions need confirmation (delete problem, end contest early)
- Accessibility: keyboard navigation, focus management, WCAG considerations
- Change rules: prefer existing tokens, match existing patterns, no decorative motion

Source: read `apps/web/src/app.css`, component library, existing pages

### CREATE: `docs/PRODUCT_SENSE.md`

Sections:
- Users and outcomes (student, teacher/admin, contest organizer, course instructor)
- Shipped scope (problems, submissions, contests, courses, assessments, plagiarism, editorials)
- Tradeoff rules (auditability, simplicity, PostgreSQL as truth, auth/authz separation)
- Explicit non-goals for this phase

### CREATE: `docs/QUALITY_SCORE.md`

Sections:
- Current grades table (area, grade, evidence, next upgrade)
- Doc drift status
- Notes on when to update

Areas to grade:
- Knowledge-store navigation
- Product specification
- Architecture docs
- Frontend guidance
- Design guidance
- Reliability guidance
- Security guidance
- Schema documentation
- Test coverage

### CREATE: `docs/PLANS.md`

Sections:
- Plan locations (active/, completed/)
- Naming convention (YYYY-MM-DD-short-topic.md)
- Lifecycle (active → completed)
- Expectations (problem, constraints, milestones, risks)

### REWRITE: `docs/SECURITY.md`

Remove (→ `THREAT_MODEL.md`):
- Trust boundaries diagram
- Sandbox isolation details
- Contest security (IP binding, whitelist, page lock)
- Full auth provider descriptions

Keep and restructure:
- Sensitive data table (what, where, protection)
- Handling rules (actionable rules for developers, like reference repo)
- Input validation table
- API rate limiting summary
- Image upload constraints
- Review expectations (when to flag for security review)

### CREATE: `docs/THREAT_MODEL.md`

Sections (following reference repo pattern):

1. **Overview** — system description, core security objectives
2. **Assets, trust boundaries, and assumptions**
   - Sensitive assets list
   - Primary trust boundaries (Browser↔Server, Code↔Sandbox, Server↔DB, Server↔S3, etc.)
   - Exposed route families
   - Attacker-controlled inputs
   - Assumptions
3. **Attack surface, mitigations, and attacker stories**
   - Authentication and sessions
   - API authorization and role enforcement
   - Problem and contest management
   - Submission and sandbox execution
   - Image upload and object storage
   - Real-time events (SSE)
   - Contest integrity (IP binding, page lock, cooldown)
   - Plagiarism detection
   - Infrastructure and configuration
4. **Criticality calibration** (critical, high, medium, low)

### REWRITE: `docs/FRONTEND.md`

Remove:
- Auth flow section (→ `SECURITY.md` handling rules)
- Permission model tables (→ `SECURITY.md`)

Add:
- Component contracts (shared UI patterns: Workspace, MarkdownRenderer, ImageDropZone, etc.)
- Validation expectations per route

Keep:
- Route map (already good)
- API routes table
- Runtime boundaries (server-side vs client-side)

### MINOR UPDATES: Other docs

- `docs/DATABASE.md` — add Related Docs section if missing
- `docs/TEMPORAL.md` — no changes needed
- `docs/JUDGE_PIPELINE.md` — no changes needed
- `docs/REDIS.md` — no changes needed
- `docs/RELIABILITY.md` — minor: ensure Related Docs links are current
- `docs/DEPLOYMENT.md` — already updated for MinIO/S3

### RESTRUCTURE: `docs/plans/`

- Move existing plan files to `docs/plans/completed/` (they are all completed designs)
- Create `docs/plans/active/` directory

## Execution Strategy

Dispatch parallel agents grouped by independence:

**Wave 1** (5 parallel agents — all independent):
1. Agent: `CLAUDE.md` + `ARCHITECTURE.md` rewrites
2. Agent: `docs/DESIGN.md` (new — needs to read app.css and components)
3. Agent: `docs/PRODUCT_SENSE.md` + `docs/QUALITY_SCORE.md` + `docs/PLANS.md` (new)
4. Agent: `docs/THREAT_MODEL.md` (new — needs full system context)
5. Agent: `docs/SECURITY.md` + `docs/FRONTEND.md` rewrites

**Wave 2** (after wave 1, 1 agent):
6. Agent: Final consistency check — verify cross-references, Related Docs links, no content overlap

## Success Criteria

- `pnpm lint` passes (no broken markdown references in code)
- Every doc has a `## Related Docs` section at the bottom
- No content duplication across docs (auth described once, not three times)
- All docs describe what IS shipped, not what WILL BE
- QUALITY_SCORE.md grades are honest and evidence-based
