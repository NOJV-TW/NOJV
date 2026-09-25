# Web application decisions

Durable decisions for the SvelteKit web app: layering, routes, forms, error handling, notifications, drafts and user-facing pages. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Frontend Surface](../architecture/FRONTEND.md).

### WEB-01 Strict top-down layers with business logic in `@nojv/application`

**Decided:** 2026-04 · **Source:** [2026-04-02-microservice-architecture-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-microservice-architecture-redesign.md), [2026-04-02-architecture-implementation-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-architecture-implementation-plan.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md)

SvelteKit is the BFF: load functions, actions and Temporal activities call `@nojv/application`, which calls `@nojv/db`; there is no separate API server. Client-safe shared types, schemas and constants live in `@nojv/core`. Business logic lives in one place, leaving room for a REST API, sandbox rewrite or domain split later.

- Rejected: a separate API server now (deferred); copying domain code into the client to dodge the import guard.
- Rule: anything taking `RequestEvent` or calling `redirect()` stays in web; extract logic into domain functions with plain parameters.
- Rule: no upward imports and no workspace cycles; the dependency table and ESLint `no-restricted-imports` in ARCHITECTURE.md are the source of truth. Do not weaken the guard.
- Rule: every workspace package has a `lint` script; `@nojv/temporal` never imports `@nojv/db` or `@nojv/application`.
- Code: `apps/web/eslint.config.mjs`, `packages/application/src`, `packages/core/src`

### WEB-02 Top-level detail and solve routes, layout-enforced gates

**Decided:** 2026-04 · **Source:** [2026-04-16-cuid-url-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-16-cuid-url-unification-design.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md)

Detail pages live at `/assignments/[id]`, `/exams/[id]`, `/contests/[id]` with role-gated tabs; solve pages are `/<kind>/[id]/problems/[problemId]` (practice: `/problems/[problemId]`) and all render the shared `ProblemSolveView`. Per-course lists and `new` pages stay under `/courses/[courseId]/...`. Three unrelated URL shapes with separate gates were replaced so child routes cannot forget a check.

- Rejected: course-nested detail routes; exam solve URLs ending in `[idx]`.
- Rule: each context root enforces its gate in its layout; a new context kind follows the same shape.
- Rule: the solve loader scopes submissions to user + context + problem; the view never filters them itself.
- Code: `apps/web/src/lib/server/problem-solve.ts`, `apps/web/src/routes/(app)/`

### WEB-03 Every form failure is visible through typed messages and one action wrapper

**Decided:** 2026-04 · **Source:** [2026-04-11-silent-failure-and-problemids-fix](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-silent-failure-and-problemids-fix.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md)

Actions return a superforms `message()` of type `FormMessage = { kind, text }` rendered by the shared `FormError` banner, with field errors inline. Actions go through `withAction`, mapping domain HttpError/ZodError to `fail(status)` like `apiHandler`/`handleLoad`. `fail(400, { form, error })` was silently discarded, and raw domain throws became 500s.

- Rejected: `fail(400, { form, error })`.
- Rule: every action failure surfaces as a banner or field error; never fail silently.
- Code: `apps/web/src/lib/types/form-message.ts`, `apps/web/src/lib/server/shared/action-handlers.ts`

### WEB-04 Fail loudly on corrupt data; validate every persisted blob on read

**Decided:** 2026-04 · **Source:** [2026-04-12-codebase-cleanup-audit](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-12-codebase-cleanup-audit.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

Domain lookups (`get*`/`load*`/`fetch*`/`require*`) throw instead of returning null or synthesizing fallbacks; boundaries catch via `handleError` and the load wrapper. Cross-deploy blobs (Redis, S3, JSON columns) are schema-validated on read: stored verdict detail throws `IntegrityError`, caches recompute on mismatch. A `safeParse` fallback once showed students a fake `wrong_answer`, and bare `as` casts served stale shapes after deploys.

- Rejected: `safeParse` fallbacks that fabricate values; bare `as` on stored data.
- Rule: nullable query returns need the `intentional-nullable` escape hatch (`scripts/check-query-returns.mjs`).
- Rule: student-controlled data (e.g. interactive stderr reports) passes a `@nojv/core` schema before use.
- Code: `scripts/check-query-returns.mjs`, `packages/application/src/submission/details.ts`, `apps/web/src/hooks.server.ts`

### WEB-05 Durable notifications are separate from toasts

**Decided:** 2026-04 · **Source:** [2026-04-19-notification-center-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-notification-center-design.md), [2026-04-19-notification-center-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-notification-center-plan.md), [2026-09-03-announcement-notification-links](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-03-announcement-notification-links.md)

A `Notification` row is a persistent review-later event behind the navbar bell; toasts are ephemeral session feedback. Rows store `{type, params}` rendered client-side through paraglide, so a locale switch updates old rows. Email delivery follows per-user preferences, falling back to the login email. Offline users previously had no way to find enrollments or deadlines.

- Rejected: a `/notifications` page, push/service workers, digests. Earlier: no email and no preferences (v1, 2026-04) — added later.
- Rule: never copy verdicts or form-success events into notifications.
- Rule: keep at most 50 per user, pruned in the insert transaction; the DB is the truth and the client refetches after SSE reconnect.
- Rule: legacy `announcement_published` rows without `linkUrl` resolve through one shared resolver for list and SSE; malformed params keep a null link, and identifiers are URL-encoded.
- Code: `packages/db/src/repositories/notification.ts`, `packages/application/src/notification/`

### WEB-06 Code drafts are keyed by context, problem and language

**Decided:** 2026-05 · **Source:** [2026-05-11-code-draft-autosave-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-11-code-draft-autosave-design.md)

Drafts are stored per user + context (practice, exam, assignment, contest, virtual) + problem + language, server-side with autosave and an encrypted local v2 cache. Students lost code on reload.

- Rejected: Earlier: localStorage-only drafts saved on Ctrl+S with no server sync or autosave (v1, 2026-05) — replaced by server drafts and autosave. TTL expiry.
- Rule: draft keys always include the context so drafts never leak across contexts.
- Rule: the server checks draft access against the scope, including active exam session limits.
- Rule: when local storage is full, evict the oldest drafts; no scheduled expiry.
- Code: `packages/application/src/code-draft.ts`, `apps/web/src/lib/stores/code-draft.ts`, `apps/web/src/lib/stores/draft-autosave.ts`

### WEB-07 Activity heatmap, streak and trend are bucketed client-side in local time

**Decided:** 2026-05 · **Source:** [2026-05-18-feature-completion-batch](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-18-feature-completion-batch.md)

The dashboard returns raw submission timestamps for a 365-day window and the browser groups them by local calendar day. UTC buckets put users outside UTC on the wrong day.

- Rejected: Earlier: UTC-bucketed `UserDailyActivity` table with a 30-day window — removed.
- Rule: do not reintroduce server-side UTC day bucketing for per-user activity.
- Code: `apps/web/src/lib/utils/activity.ts`, `apps/web/src/routes/(app)/dashboard/+page.server.ts`

### WEB-08 Public profiles are opt-in and hidden ones 404

**Decided:** 2026-07 · **Source:** [2026-07-10-gradebook-public-profile](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-gradebook-public-profile.md)

`User.profilePublic` defaults to false. Public profiles are viewable without login; private ones only by the owner and effective admins. Only solved public, published problems are shown, and distributions derive from that set. This avoids leaking account existence or private solves.

- Rule: "missing" and "not visible" return the same 404.
- Rule: admin checks use the effective role, never the stored role alone.
- Code: `packages/application/src/user/profile.ts`, `apps/web/src/routes/(public)/users/[id]`

### WEB-09 Admin mode routes content navigation to the global admin lists

**Decided:** 2026-09 · **Source:** [2026-09-07-admin-content-entry](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-07-admin-content-entry.md)

With admin mode active, the courses/assignments/exams/contests lists redirect to the existing `/admin/*` lists, which query all resources and authorize the effective actor. Personal lists were shown in admin mode, and reuse avoids a second list implementation.

- Rejected: a duplicate list implementation; any stored-role authorization bypass.
- Rule: admin viewing or editing never creates course memberships; lifecycle edit restrictions still apply.
- Code: `apps/web/src/routes/(app)/{courses,assignments,exams,contests}/+page.server.ts`
