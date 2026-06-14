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

## Build & upload

```sh
docker build -t my-service .
docker save my-service -o my-service.tar
```

Upload `my-service.tar` as the **service** image on the problem's Advanced
settings page (mode = service), or push to a registry and paste the reference.
On the Kubernetes backend a registry reference is required (tarball service
images are refused there).

## How the run container reaches it

In your `runner.py`, read the injected `host:port` and build a URL:

```python
import nojv_runner as nojv
host = nojv.service_host()  # "host:port", e.g. "service:8888" or "10.96.0.42:8888"
resp = requests.get(f"http://{host}/health")
```

The run container has no direct internet route, so this service is the only peer
it can reach.
