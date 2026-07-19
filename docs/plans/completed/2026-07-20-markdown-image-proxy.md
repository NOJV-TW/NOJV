# Markdown Image Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep third-party Markdown images while preventing readers' browsers from contacting third-party image hosts.

**Architecture:** The shared Markdown sanitizer rewrites remote HTTPS image sources to a same-origin read-only endpoint. The endpoint validates and DNS-pins every HTTPS hop, rejects non-public addresses, bounds redirects/time/bytes, verifies raster image magic bytes, and stores the first successful response in the existing S3-compatible bucket under a deterministic URL hash. Existing Markdown remains unchanged and is upgraded at render time, so production needs no database migration or backfill.

**Tech Stack:** SvelteKit, DOMPurify, Node.js `dns`/`https`/`net`, existing `@nojv/storage`, Vitest.

---

### Task 1: Rewrite remote Markdown image loads

**Files:**

- Modify: `apps/web/src/lib/utils/markdown.ts`
- Modify: `apps/web/svelte.config.js`
- Test: `tests/unit/web/markdown.test.ts`
- Test: `tests/integration/web/markdown-renderer-xss.test.ts`

1. Add failing tests proving HTTPS and protocol-relative `<img src>` values become same-origin proxy URLs, first-party/data images remain unchanged, unsafe schemes are removed, and `srcset` cannot bypass rewriting.
2. Extend the existing DOMPurify attribute hook instead of adding a second rendering pipeline.
3. Remove arbitrary HTTPS from `img-src`; keep only `self`, `data:`, and `blob:` so any missed remote image fails closed.
4. Run the focused Markdown unit and integration tests.

### Task 2: Add bounded SSRF-safe retrieval

**Files:**

- Create: `apps/web/src/lib/server/remote-image.ts`
- Test: `tests/unit/web/remote-image.test.ts`

1. Add failing tests for HTTP URLs, credentials, non-443 ports, local/private/reserved IPv4 and IPv6, mixed public/private DNS answers, private redirects, redirect loops, oversize bodies, invalid image bytes, and public HTTPS success.
2. Parse canonical HTTPS URLs with a fixed maximum length.
3. Resolve every hop with `dns.lookup({ all: true })`, reject the whole hostname if any answer is non-public, and pin the selected address into `https.request` so DNS cannot change between validation and connection.
4. Follow at most three redirects, re-running validation on every hop; use a total request timeout and a 5 MB streaming limit.
5. Accept only PNG, JPEG, GIF, or WebP detected from bytes; never trust the upstream `Content-Type`.

### Task 3: Reuse object storage as a first-write-wins cache

**Files:**

- Modify: `packages/storage/src/object.ts`
- Modify: `packages/storage/src/images.ts`
- Modify: `packages/storage/src/index.ts`
- Test: `tests/unit/storage/immutable-object.test.ts`
- Test: `tests/unit/storage/images.test.ts`

1. Add failing tests for deterministic SHA-256 URL keys, cache hits, atomic create-only writes, and concurrent first-writer-wins behavior.
2. Extract the existing conditional S3 put into a small `putObjectIfAbsent` primitive while preserving immutable-object verification semantics.
3. Store remote images under `remote-images/<sha256(url)>` and serve the stored content type.

### Task 4: Expose the same-origin image endpoint

**Files:**

- Create: `apps/web/src/routes/api/images/proxy/+server.ts`
- Create: `apps/web/src/lib/server/storage/remote-image.ts`
- Test: `tests/unit/web/remote-image-route.test.ts`

1. Add failing route tests for a cache hit, a cache miss, missing URL, self-recursion, and safe response headers.
2. Apply the existing read API rate limiter.
3. Read cache before any network request; on a miss, fetch safely, atomically cache, then serve the stored result.
4. Return immutable cache headers, `nosniff`, and same-origin resource policy. Never redirect the browser to the third-party URL on failure.

### Task 5: Align living security documentation

**Files:**

- Modify: `docs/operations/SECURITY.md`
- Modify: `docs/operations/THREAT_MODEL.md`
- Modify: `docs/architecture/FRONTEND.md`

1. Replace the accepted direct-image privacy leak with the proxy/cache invariant.
2. Document SSRF, redirect, file-size/type, rate-limit, and fail-closed behavior.
3. State explicitly that existing Markdown is rewritten at render time and needs no production data migration.
4. Do not modify the user-facing privacy policy.

### Task 6: Verify the PR

1. Run the focused Markdown, remote-image, route, and storage tests.
2. Run storage/web/test type checks and formatting.
3. Run `pnpm ci:verify`.
4. Review the complete dirty-worktree diff and move this plan to `docs/plans/completed/` only after all checks pass.
