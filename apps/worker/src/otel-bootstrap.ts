// Sole-purpose file: target for `node --import ./src/otel-bootstrap.ts` in
// dev. Loaded by --import, this file is fully evaluated BEFORE index.ts is
// even parsed, guaranteeing OTel auto-instrumentation hooks are registered
// before pg/ioredis/etc. are imported.
//
// Production (bundled dist/index.js) does NOT use --import; it relies on the
// inline `import "./otel.js"` as the first line of index.ts, which is
// sufficient per ESM evaluation order (DFS by source order).
import "./otel.js";
