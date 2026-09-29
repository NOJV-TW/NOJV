# Judge testcase ConfigMap cache

## Problem

Every Kubernetes stage re-uploads its testcases as payload ConfigMaps (run: inputs;
judge: inputs and/or answers) and deletes them at cleanup. Problem 79 (30 cases,
~37 MB) uploads ~100 ConfigMaps / ~70 MB per submission to k3s (kine/SQLite); an
exam with 50 students repeats that 50 times. The 2026-09-29 incident (HTTP/2 stream
errors during mass creates, then an OOM-looping judge worker whose recovery
`reconcile` listed every ConfigMap in the namespace with its data) came from this
volume.

## Design

**Unit of caching: one set per role per stage range.** A stage's testcase files are
split out of its payload by name: inputs (`testcase-N-input.txt`,
`case-N-input.txt`) go to the `input` set, answers (`case-N-answer.txt`) to the
`answer` set. Each set holds the unique file bodies (by SHA-256) packed into 750 KB
binary shards exactly like today. Stage ranges are a pure function of the snapshot
(`judgeStageRanges`), so every submission of the same testcase version produces the
same sets; per-case ConfigMaps were rejected because a 100-case stage would project
100–200 sources per volume and need one existence check per case.

**Content-addressed names.** `key = sha256("nojv-testcase-set/v1", role, shard size,
sorted unique file SHA-256s)[0:32]`. The SHA-256s are the same content hashes the
judge snapshot pins (#590/#591), computed over the bytes actually shipped, which the
manifest already needs. Index `tc-<key>` (small, `data["layout.json"]` = file →
chunk keys); shards `tc-<key>-<index uid[0:16]>-<k>` with an ownerReference to the
index. Chunk keys are `chunk-<15 digits from the key><6-digit n>`, so they match the
existing runner's `^chunk-\d+$` (old pinned sandbox images keep working) and never
collide with stage chunks (`chunk-<6 digits>`); a stage asserts all keys it mounts
are distinct.

**Per-stage ConfigMaps** keep only `config.json`, sources, validator/interactor and
`payload-manifest.json`; the manifest lists the testcase files with chunk keys that
live in the cached shards, so the materializer (unchanged) verifies size and SHA-256
end to end. The run volume projects stage CMs + the `input` set only; the judge
volume adds the `answer` set (and `input` for checkers). JDG-05 holds by
construction: run payloads never contain answer files, so the run volume never
references an `answer` shard (unit-tested).

**Create-once protocol.**

1. GET index. 404 → create it (`state=pending`, `last-used=now`); 409 → re-read.
2. Verify labels (`nojv-testcase-key`, role) and `layout.json` equal the expected
   value; a mismatch is an infrastructure error (never trusted, never overwritten).
3. `ready` → touch `last-used` (merge patch with `resourceVersion`) if older than
   10 min, then use it.
4. `pending` → the creator (or anyone after a 2 min takeover window) creates the
   shards (409 = already created for this incarnation, since names carry the index
   UID), then patches `ready`. Others poll every second.
   Many concurrent submissions therefore create each object once; waiting is bounded
   (5 min, then a transient infrastructure error that the durable judge retries).

**GC.** Each Kubernetes judge worker runs a sweep every 15 min: list index
ConfigMaps by label (no shard data) and all sandbox Pods; delete an index idle for
12 h unless a Pod projects any of its shards, with `uid` + `resourceVersion`
preconditions so a concurrent touch wins. Kubernetes' garbage collector removes the
shards through their ownerReference, including shards of a crashed creator.
Superseded versions simply stop being touched and age out.

**Unchanged.** Per-stage objects keep the `judge-<runId>` prefix, the lease and
`cleanupConfirmed` semantics and the 30 s cleanup budget. `reconcile` lists
ConfigMaps by the `nojv-run-id` label so cached testcase data never enters recovery
listings. 64 MiB stage budget, 1 MiB object limit, emptyDir sizes unchanged. RBAC
gains `patch` on sandbox ConfigMaps; there is no ConfigMap quota.

## Verification

Unit: naming stability, create-or-reuse under concurrency, mismatch rejection,
JDG-05 volume separation, GC in-use/fresh/stale decisions, materializer round trip.
k3d: 30 cases / ≥30 MB, concurrent submissions of the same problem (AC and WA),
each cached object created exactly once, GC removes the set and its shards, no
`judge-<runId>` leftovers; per-stage payload time cold vs warm vs the old inline
upload.
