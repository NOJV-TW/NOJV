# NOJV advanced-judge — SERVICE image

The optional **service** image is a TA-provided dependency the student program
talks to in `service` network mode — a mock API, a database, a simulator. The
platform starts it alongside the run container and injects its address into the
run container as **`$NOJV_SERVICE_HOST`** (a `host:port` value); the student
program reaches it over an internal-only network and has no other route out.

The platform reaches your service on **`$PORT` (8888)** — it injects `PORT=8888`
into this container. A custom service **MUST listen on `$PORT`**; the run
container only ever connects to that port.

The service is **trusted** (you authored it) and has **full network**, so it may
forward to a real upstream if needed. It runs **only during the run phase** and
never sees the answers.

## ⚠️ SECURITY: never let the student choose where the service connects

The service has **full internet access** AND the student's run code can send it
arbitrary requests. If your service forwards to a destination the **request
controls**, you have built an open proxy: the student reaches the entire internet
through it (search engines, pastebins, their own server) and cheats. This defeats
the whole point of `service` mode.

Hard rules:

- **NO** request-controlled destination (`?url=`, `?host=`, `?target=`, a body
  field naming the upstream). The student must never decide where you connect.
- **NO** open relay / forward-proxy / SSRF surface.
- Forward **only to fixed upstreams you hard-code** for the assignment.

```python
# WRONG — open proxy: the student names the destination → reaches all of the internet
def do_GET(self):
    target = parse_qs(urlparse(self.path).query)["url"][0]  # student-controlled!
    body = requests.get(target).content                     # exfiltration channel
    self.respond(body)

# RIGHT — fixed upstream you chose; the student supplies only data, never a destination
ALLOWED_UPSTREAM = "https://api.internal.example.com"
def do_GET(self):
    q = parse_qs(urlparse(self.path).query).get("q", [""])[0]
    body = requests.get(f"{ALLOWED_UPSTREAM}/lookup", params={"q": q}).content
    self.respond(body)
```

## Files

| File         | What it is                                                         |
| ------------ | ------------------------------------------------------------------ |
| `Dockerfile` | Builds the service image.                                          |
| `service.py` | **The file you edit.** A minimal stdlib HTTP server you customize. |

## The readiness contract

Your service **must print the exact line `NOJV_SERVICE_READY` to stdout** once it
is listening. The platform polls for that marker before it starts the run
container, so the student program never races a not-yet-ready service. Print it
only **after** the socket is bound and listening (the scaffold does this).

## Build & push

The service is **optional** — you only need it when the run container must talk
to a companion (mock API, DB, simulator). If you use it, build and push it like
the run/grade images, then set the problem's **network mode** to `service` and
paste the **digest-pinned** reference into the editor's **Service image** field:

```sh
# The service holds no answers, so a public registry (ghcr.io, …) is fine — or use
# the platform registry with REG from the editor's "Registry push account" card:
REG=<registry-host>/t/<your-username>
docker build -t "$REG/PROBLEM-service:v1" ./service
docker push "$REG/PROBLEM-service:v1"
docker buildx imagetools inspect "$REG/PROBLEM-service:v1"   # copy the sha256 digest
# paste $REG/PROBLEM-service@sha256:<digest> into the editor's Service image field
```

See the top-level `README.md` for the full workflow.

## How the run container reaches it

In your `runner.py`, read the injected `host:port` and build a URL:

```python
import nojv_runner as nojv
host = nojv.service_host()  # "host:port", e.g. "service:8888" or "10.96.0.42:8888"
resp = requests.get(f"http://{host}/health")
```

The run container has no direct internet route, so this service is the only peer
it can reach.
