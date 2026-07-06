# Cloudflare-native Edge (remove self-injected edge-secret + host proxy) Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:executing-plans. This touches the
> exam IP-gate security boundary and prod host services — execute task-by-task, verify each
> step, and keep every step independently reversible. Do NOT bundle into one big cutover.

**Goal:** The public origin is reachable **only** through Cloudflare, so `cf-connecting-ip`
can be trusted directly. Then delete the self-built trust layer: the host `nojv-edge-proxy`
(`proxy.py`) and the `x-nojv-edge-secret` / `EDGE_TRUST_SECRET` mechanism.

**Why this exists today (do not skip):** DNS pointing at Cloudflare does **not** force traffic
through Cloudflare. The web origin is a k3s **NodePort (`:32198`)** reachable on every node
interface, including the LAN (`192.168.99.x`, likely the exam network). An attacker on that LAN
can hit the origin directly, bypass Cloudflare, and forge `cf-connecting-ip` to defeat the exam
IP gate. The host `proxy.py` injects a shared secret `x-nojv-edge-secret`; the app
(`apps/web/src/lib/server/shared/client-ip.ts`) trusts `cf-connecting-ip` **only** when that
secret is present and correct. So the secret is real defense today — **removing it without first
closing the direct-to-origin path opens a cheating bypass.**

**End-state architecture:** Run **cloudflared as an in-cluster Deployment** connecting to the web
**ClusterIP** service (`http://nojv-web.nojv.svc:80`). The host NodePort, the host cloudflared
process, and `proxy.py` all go away. With no non-Cloudflare path to the origin, `cf-connecting-ip`
is trustworthy on its own and the secret check is deleted.

**Current chain (to dismantle):**
`Cloudflare → host cloudflared (token tunnel, pid ~1089) → 127.0.0.1:3000 proxy.py → web NodePort :32198`

**Target chain:**
`Cloudflare → in-cluster cloudflared Deployment → web ClusterIP :80`

**2026-07-07 topology reality (checked on the box):** the app tunnel `nojv.tw`
(`2a5668ea…`, host `cloudflared-tw.service`, was mislabeled "account B") is actually a **named
tunnel in our own Cloudflare account** (same cert.pem as the SSH tunnel `nojv-ssh`). So the whole
cutover runs via the `cloudflared` CLI on the box — no dashboard. New named tunnel
**`nojv-app` = `765634dd-c7fa-41db-99f1-3447334055be`** created (config mode, credentials at
`~/.cloudflared/765634dd….json`). The old `nojv.tw` tunnel also carries `coreteam-ssh.nojv.tw→:22`
(a teammate's throwaway SSH hole) — deleting the old tunnel removes it too. Cutover is split into
two deploys (below) so the NodePort is never removed before the new path is proven.

**Two jobs `proxy.py` does today — both must be rehomed before deleting it:**

1. Inject `x-nojv-edge-secret` → **deleted** (no longer needed once origin is locked).
2. Force `Cache-Control: no-transform` — added to stop Chrome's zstd path corrupting JS.
   Must be rehomed: either the SvelteKit app sets `no-transform` on HTML/JS responses, or a
   Cloudflare Compression/Transform setting disables zstd re-compression. **Decide in Task 1.**

---

## Ordering is the safety property

Lock the origin **first**, remove the secret **last**. If reversed, there is a window where the
origin is reachable on the LAN with no secret guard = open exam bypass.

## Phase 1 — no-transform: DECIDED = don't rehome, test after cutover

**Decision (2026-07-07):** Do **not** carry `no-transform` into the new design. It was a blanket
kill of _all_ Cloudflare compression to dodge a period-specific Chrome zstd bug — likely already
fixed on both CF and Chrome, and a blunt instrument even if not. Removing it also un-does the
current cost: proxy.py sends `Accept-Encoding: identity` upstream, so the whole chain ships
uncompressed today.

### Task 1.1: (no code) verify at cutover, add a zstd-only rule only if it actually breaks

- New architecture adds **no** no-transform; let Cloudflare compress normally.
- **Verify at cutover:** load the site in Chrome through the in-cluster tunnel; check JS loads and
  console is clean.
- If (and only if) JS corrupts → add a Cloudflare rule that disables **zstd only** (keep
  brotli/gzip). Not a blanket no-transform. This downgrades Phase 1 from a blocker to a
  post-cutover check.

**Not doing Terraform (2026-07-07):** decided to keep Helm as the single deploy path; GKE stays a
retained chart values target for later, no Terraform layer this branch.

## Phase 2 — Move cloudflared into the cluster (lock the origin)

### Task 2.1: cloudflared Deployment in the chart

- Add a `cloudflared` Deployment + `Secret` (tunnel token) to `infra/charts/nojv`, gated behind a
  values flag (`edge.cloudflared.enabled`), connecting to `nojv-web.<ns>.svc:80`.
- Token: move the host tunnel's token into a k8s Secret (from `~/nojv-edge-proxy/proxy.env` /
  the host cloudflared unit). **Do not commit the token.**
- Update the Cloudflare dashboard tunnel's public-hostname ingress: `nojv.tw` → the in-cluster
  service (the tunnel is remotely-managed, so ingress lives in the dashboard).
- **Verify:** in-cluster cloudflared registers connections; site serves through it while the host
  path still exists (both can run briefly — Cloudflare load-balances tunnel connections).

### Task 2.2: web Service NodePort → ClusterIP

- Change `values-single-machine.yaml` `web.service.type` to `ClusterIP`, drop the fixed nodePort.
- **Verify:** `192.168.99.3:32198` is no longer reachable from the LAN; site still up via the
  in-cluster tunnel. This is the step that actually closes the bypass.

### Task 2.3: Decommission host edge components

- `sudo systemctl disable --now nojv-edge-proxy.service` and stop the host cloudflared unit.
- **Verify:** site fully served by in-cluster cloudflared; `pgrep cloudflared` shows only the SSH
  tunnel (`cloudflared-ssh`). Keep the unit files for one deploy cycle as rollback.

## Phase 3 — Remove the secret (now redundant)

### Task 3.1: Simplify `client-ip.ts`

- In production, read `cf-connecting-ip` directly (still `isIP`-validate); delete the
  `x-nojv-edge-secret` / `EDGE_TRUST_SECRET` check and the `EDGE_TRUST_HEADER` constant.
- **Verify:** exam page + submission path resolve the real client IP; a request without the secret
  no longer 403s; IP gate still enforces on the correct IP (integration test).

### Task 3.2: Drop the env + chart wiring

- Remove `EDGE_TRUST_SECRET` from `apps/web/src/lib/server/env.ts`, the chart
  (`web.deployment.yaml`, `secret.example.yaml`), and `nojv-runtime-secrets` on the box.
- Remove the `~/nojv-edge-proxy/` dir and its systemd unit from the host.
- Update `docs/operations/DEPLOYMENT.md` + `SECURITY.md` (edge-trust section).

## Rollback

Each phase is independently revertible: re-point the Cloudflare tunnel ingress back to the host
proxy, re-enable the host services, restore `web.service.type: NodePort`, and (if 3.x shipped)
`helm rollback` the app + re-add `EDGE_TRUST_SECRET`. Do **not** ship Phase 3 in the same deploy
as Phase 2 — verify the locked origin holds for at least one real exam first.

## Risks

- **Exam bypass** if Phase 3 lands before Phase 2 fully locks the origin. Ordering guard above.
- **Site down / 403** if the in-cluster tunnel or Cloudflare ingress is misconfigured — verify
  with both paths live before decommissioning the host path.
- **zstd JS corruption regression** if Task 1.1 is skipped. Gate proxy.py deletion on it.

## Open questions

- ~~Task 1.1: app-side header vs Cloudflare setting for `no-transform`?~~ → DECIDED: neither; drop
  it, test at cutover, add a zstd-only CF rule only if JS actually breaks.
- Keep the `EDGE_TRUST_SECRET` code path behind a flag for one release as a safety net, or remove
  outright once the locked origin is proven?
