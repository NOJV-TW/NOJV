# Public And Internal API Documentation

## Status — Implemented (2026-06-05)

Shipped in PR #98 (branch `feature/public-api-docs`). The OpenAPI documents were
audited operation-by-operation against the real route handlers (all 5 public + 52
internal operations): every documented path, method, path/query parameter, request
body schema, response, and auth requirement matches the handlers, with no HIGH
discrepancies. `@nojv/core` Zod schemas are reused wherever an exported schema
exists; hand-written schemas are used only for response projections without one.

As-built (after the post-merge convention pass):

- Human-facing Scalar pages are served at top-level `/docs` (public) and
  `/docs/internal` (maintainer) via `apps/web/src/routes/docs/`. The JSON specs stay
  under `/api/openapi.{public,internal}.json` (a spec is a legitimate API resource).
- `POST /api/submissions/{id}/rejudge` (single-submission rejudge) was added to the
  internal document under the Rejudge tag during the audit — counterpart to the batch
  `POST /api/rejudges`.
- The internal document is intentionally non-exhaustive (a curated maintainer
  reference); niche authoring routes
  (`/api/problems/{id}/{checker,interactor,workspace/files,bundle}`) and the SSE
  `/api/submissions/{id}/stream` are left undocumented by design.
- `internal-document.ts` is a thin assembler; path operations are split per-tag under
  `src/lib/server/openapi/internal/paths/` and component schemas under
  `internal/schemas.ts`.
- `tests/unit/openapi-contract.test.ts` fails CI if a new API route is added without
  documenting it (or allowlisting it as an intentional omission), and if the docs ever
  reference a path with no real handler.

## Background

PR #91, which attempted to add a `/api/v1/**` API skeleton, has been closed.
That direction created duplicate endpoints only for documentation, but those
endpoints were not used by the application and did not represent the real API
behavior.

The revised direction is documentation-only:

- describe existing API endpoints;
- render the documentation with Scalar;
- do not add duplicate `/api/v1/**` endpoints;
- do not change existing API route behavior;
- keep the implementation as a pure documentation layer.

## Goal

Use Scalar and OpenAPI documents to present the existing NOJV API as readable API
documentation.

This work should not introduce new API endpoints for business logic. The only
new routes should be documentation routes that serve or render OpenAPI
documents.

## Scope

- Write OpenAPI documents that describe existing API endpoints, including
  paths, methods, parameters, request bodies, responses, and schemas.
- Render the OpenAPI documents with Scalar.
- Split public and internal documentation when useful, using separate OpenAPI
  documents rather than separate API endpoint folders.
- Verify that the documentation process does not change existing API behavior.

## Non-Goals

- Do not create duplicate `/api/v1/**` endpoints only for documentation.
- Do not modify existing API route handlers unless a route bug is discovered
  independently from the documentation work.
- Do not implement API token authentication in this documentation PR.
- Do not expose every internal API as part of the public API contract.
- Do not promise long-term compatibility for internal-only web APIs.

## Current API Documentation Design

Use OpenAPI 3.1 and Scalar.

Recommended files:

```text
apps/web/src/lib/server/openapi/public-document.ts
apps/web/src/lib/server/openapi/internal-document.ts
apps/web/src/lib/server/openapi/zod-schema.ts
apps/web/src/routes/api/openapi.public.json/+server.ts
apps/web/src/routes/api/openapi.internal.json/+server.ts
apps/web/src/routes/api/docs/public/+server.ts
apps/web/src/routes/api/docs/internal/+server.ts
```

Recommended routes (as-built):

```text
GET /api/openapi.public.json
GET /api/openapi.internal.json
GET /api/docs/public
GET /api/docs/internal
```

The public document should describe only selected existing endpoints that are
reasonable to show to external students or external tools.

The internal document can describe a broader set of session-based web APIs used
by the application, including admin and staff workflows.

## Public Documentation

The public document should stay conservative. It should describe only existing
routes that are safe and useful to expose as external-facing documentation.

Initial public API documentation:

| Endpoint                       | Method | Purpose                          |
| ------------------------------ | ------ | -------------------------------- |
| `/api/healthz`                 | GET    | Public health check              |
| `/api/submissions`             | POST   | Create a submission              |
| `/api/submissions/{id}`        | GET    | Get submission status and result |
| `/api/submissions/{id}/source` | GET    | Get submission source files      |

Public documentation notes:

- These are existing endpoints, not new `/api/v1/**` endpoints.
- Mutation endpoints may still require the current browser-session and
  `X-Requested-With: fetch` behavior until a future token-auth project changes
  the authentication model.
- The docs should clearly describe the current auth behavior instead of
  pretending Bearer token auth already exists.
- Scalar Ask AI or model-assisted features should remain disabled for public
  docs.

## Internal Documentation

The internal document can include a wider set of existing APIs used by the web
application.

Suggested internal tags:

- System
- Account
- Problems Management
- Submissions
- Rejudge
- Contests
- Exams / Proctoring
- Clarifications
- Notifications
- Editorials
- Plagiarism
- Grading
- Uploads
- Events

Internal documentation is not a public compatibility promise. It is primarily a
developer reference for the current web API surface.

## Schema Strategy

Prefer existing `@nojv/core` Zod schemas whenever a matching schema exists.

Use the local OpenAPI helper to convert Zod schemas into OpenAPI-compatible
schemas:

```text
apps/web/src/lib/server/openapi/zod-schema.ts
```

Use Zod-derived schemas for request and response shapes such as:

- submission draft and submission operation schemas;
- editorial submit, update, and vote schemas;
- feedback upsert schemas;
- shared enums such as supported language, scoreboard mode, contest scoring
  mode, and IP violation type.

Only hand-write OpenAPI schemas when no matching exported Zod schema exists.
This is expected for many domain-layer response projections, such as:

- notification list items;
- clarification board items;
- plagiarism report summaries;
- score override rows;
- scoreboard response projections;
- upload response wrappers;
- server-sent event streams.

Do not force unrelated Zod schemas onto an endpoint. For example:

- `problemCreateSchema` is used by problem editor page actions, but
  `POST /api/problems` currently accepts only an optional `mode` field and
  creates a default draft problem.
- `contestCreateSchema` and `contestUpdateSchema` are used by contest page
  actions, but the current `/api/contests/**` routes documented here are
  scoreboard and chart APIs.

Using those schemas for the API docs would make the documentation inaccurate.

## Safety Decisions

- Public docs should not send student input, source code, tokens, or API
  metadata to third-party AI services.
- Interactive request execution should be treated carefully for public docs
  because current routes are session-based and may require CSRF-style headers.
- Internal docs may be broader, but they should still document existing route
  behavior rather than idealized future behavior.
- Existing browser-session APIs and CSRF checks must continue working exactly as
  before.

## Acceptance Criteria

- `GET /api/openapi.public.json` returns a valid OpenAPI JSON document.
- `GET /api/openapi.internal.json` returns a valid OpenAPI JSON document.
- `GET /api/docs` renders the public Scalar API documentation.
- `GET /api/docs/internal` renders the internal Scalar API documentation.
- No new business API endpoints are introduced.
- Existing API route behavior is unchanged.
- Matching `@nojv/core` Zod schemas are reused where available.
- Hand-written OpenAPI schemas are used only when there is no matching exported
  Zod schema.

## Testing Plan

Documentation checks:

- Open `/api/docs` locally and verify the public docs render.
- Open `/api/docs/internal` locally and verify the internal docs render.
- Fetch `/api/openapi.public.json` and `/api/openapi.internal.json` and verify
  both return JSON.
- Spot-check the documented request and response schemas against the actual
  route handlers.

Code checks:

- Run Prettier on the OpenAPI document files.
- Run ESLint on the OpenAPI document files.
- Run the project typecheck when local dependencies are healthy.

Regression checks:

- Existing session-based APIs still work.
- Existing CSRF behavior for internal mutation APIs is unchanged.
- The browser app behavior is unchanged.

## Future Work

API token authentication should be handled in a separate project.

That future project can define:

- Bearer token format;
- token storage and hashing;
- scopes;
- expiry;
- rotation;
- revocation;
- token management UI;
- OpenAPI auth documentation.

This documentation PR should not implement those features.
