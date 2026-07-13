# NOJV advanced-judge — SERVICE image

The optional **service** image is a TA-provided dependency the student program
talks to in `service` network mode — a mock API, a database, a simulator. The
platform starts it alongside the run container and injects its address into the
run container as **`$NOJV_SERVICE_HOST`** (a `host:port` value); the student
program reaches it over an internal-only network and has no other route out.

The platform reaches your service on **`$PORT` (8888)** — it injects `PORT=8888`
into this container. A custom service **MUST listen on `$PORT`**; the run
container only ever connects to that port.

The service is **network-isolated**: it accepts requests only from that
submission's run container and has no network route to the internet, cluster,
or other submissions. It runs **only during the run phase** and never sees the
answers. Put every dependency needed by the service into its image.

The image must run as `USER 10001:10001` on every executor backend. Keep that
line in custom service images, and make image files needed at runtime readable
by uid/gid 10001.

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
