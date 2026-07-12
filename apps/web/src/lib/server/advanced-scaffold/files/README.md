# NOJV Advanced Mode — image templates

An Advanced Mode (`special_env`) problem runs **your own container images**, so
you control the exact toolchain, answers, and grading logic. There are two
required images plus one optional:

| Directory  | Image    | Runs                                                  | Holds answers |
| ---------- | -------- | ----------------------------------------------------- | ------------- |
| `run/`     | required | the **student's code** against your inputs            | never         |
| `grade/`   | required | your grader over the run output (**no student code**) | yes (baked)   |
| `service/` | optional | a companion the student talks to in `service` mode    | never         |

You build these images yourself, push them to a registry NOJV can pull, and
paste the **digest-pinned** references into the problem editor. **NOJV never
builds images for you** — your build stays entirely under your control.

## Workflow

### 1. Edit the templates

- `run/runner.py` — run the student program per testcase, write outputs to
  `/workspace/output/`. Bake your inputs into `run/testcases/`.
- `grade/grader.py` — compare the run output to your answers, write the verdict.
  Bake your answers into `grade/answers/`.
- `service/service.py` — only if you need `service` network mode.

Each directory's `README.md` documents its exact platform contract (mount paths,
`meta.json`, `result.json`, readiness marker). The `nojv_runner.py` /
`nojv_grader.py` helpers implement the contract for you — don't edit them.

### 2. Build each image

```sh
docker build -t ghcr.io/YOUR-ORG/PROBLEM-run:v1   ./run
docker build -t ghcr.io/YOUR-ORG/PROBLEM-grade:v1 ./grade
# optional:
docker build -t ghcr.io/YOUR-ORG/PROBLEM-service:v1 ./service
```

Test locally before pushing — run each image against a sample submission to
confirm it produces a `result.json` you expect.

### 3. Push and read the digest

```sh
docker push ghcr.io/YOUR-ORG/PROBLEM-run:v1
docker buildx imagetools inspect ghcr.io/YOUR-ORG/PROBLEM-run:v1   # prints sha256:<digest>
```

### 4. Reference by digest in the editor

Paste the **digest-pinned** form (not a mutable `:tag`) into the matching field
of the problem's **Judge environment images** section:

```
ghcr.io/YOUR-ORG/PROBLEM-run@sha256:<64 hex chars>
```

Digest pinning guarantees the judged environment can never change behind a
moved tag. Then submit a reference solution from the workspace — an **accepted**
test run is required before you can publish.

## Allowed registries

The editor shows which registry hosts are accepted (the major public registries
are trusted by default). Ask an administrator if you need another host added.

## Privacy — images with answers or hidden tests must be private

The `grade` image holds your answers and the `run` image holds your hidden test
inputs. If those are secret, **push them as private packages** so students can't
pull them. Public images are fine only when the environment isn't secret (e.g. a
demo). Private images require NOJV to be configured with pull access to your
registry — ask an administrator to set that up.
