# NOJV advanced-judge — GRADE image

The **grade** image is the trusted half of the advanced-mode split: **no student
code runs here**. It is the only place the **answers** live (baked into
`/answers`). It reads the run phase's sanitized outputs (mounted read-only at
`/workspace/run-output/`) and the answers, compares them, and writes the final
verdict. Because no student code runs in this container, the answers can never
leak — that is the whole point of the run/grade split.

## Files

| File             | What it is                                                                       |
| ---------------- | -------------------------------------------------------------------------------- |
| `Dockerfile`     | Builds the grade image. Bakes the `answers/` + grading code.                     |
| `grader.py`      | **The file you edit.** Compares run outputs to answers and scores.               |
| `nojv_grader.py` | Helper — reads the contract, writes a valid `result.json`. Don't edit.           |
| `answers/`       | Baked-in **answers** (`case-*.out`). Live ONLY here — never exposed to students. |

## Build & push

Build this image yourself and push it to a registry NOJV can pull, then paste
the **digest-pinned** reference into the problem editor's **Grade image** field:

```sh
# The grade image holds your answers — it MUST be private. Tag it for the
# platform registry using REG from the editor's "Registry push account" card:
REG=<registry-host>/t/<your-username>
docker build -t "$REG/PROBLEM-grade:v1" ./grade
docker push "$REG/PROBLEM-grade:v1"
docker buildx imagetools inspect "$REG/PROBLEM-grade:v1"   # copy the sha256 digest
# paste $REG/PROBLEM-grade@sha256:<digest> into the editor's Grade image field
```

Because this image holds the answers, **keep it private** and make sure NOJV is
configured to pull from your registry. See the top-level `README.md`.

## The contract

The platform mounts `/workspace` and runs your image after the run phase exits:

```
/workspace/run-output/        the run phase's /output, READ-ONLY (binary OK)
/workspace/meta.json          { submissionId, language, runStatus, maxScore }
/workspace/output/result.json you write the verdict here
/answers/                     your baked-in answers (case-*.out)
```

`runStatus` is the worker-observed run-container outcome:

```jsonc
{ "state": "exited" | "timed_out" | "oom_killed", "exitCode": 0 }
```

Use it to emit a whole-submission TLE/MLE when the run container died
catastrophically (`nojv.fatal_run_verdict()`); decide ordinary per-case
verdicts from the outputs yourself. An **empty** run output is a legitimate
outcome (the program printed nothing → render WA/RE), not an error.

## result.json shape

`nojv_grader.write_result(...)` produces this for you:

```jsonc
{
  "score": 85, // 0..maxScore — accepted must equal maxScore; use nojv.max_score()
  "verdict": "wrong_answer", // accepted | wrong_answer | time_limit_exceeded
  //          | memory_limit_exceeded | runtime_error | compile_error
  "feedback": "5/6 passed", // optional
  "testcases": [
    // optional per-case detail; verdict is AC | WA | TLE | MLE | RE | SE
    { "index": 0, "verdict": "AC", "runtimeMs": 23 },
  ],
}
```

A missing / malformed `result.json` is treated as a System Error, so always let
`write_result` produce it.

## Network

The grade container has **no network egress** in any mode — grading must be
self-contained. Bake every tool and dataset you need into the image at build
time; anything interactive belongs in the `service` container instead.
