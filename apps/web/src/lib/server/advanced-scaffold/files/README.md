# NOJV advanced-judge starter

A self-contained scaffold for an **advanced-mode** (special-env) judge image.
Download it, edit one file, build, and upload — no registry or custom base
image required.

## Files

| File             | What it is                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `Dockerfile`     | Builds the judge image from `python:3.12-slim`. Bakes in your code + testcases.                            |
| `grader.py`      | **The file you edit.** Runs the submission against your testcases and scores it.                           |
| `nojv_grader.py` | Helper library — reads the contract, runs the submission safely, writes a valid `result.json`. Don't edit. |
| `testcases/`     | Your test data. Add/replace `case-*.json` (`{ "stdin": ..., "expected": ... }`).                           |

## Build & upload

```sh
docker build -t my-judge .
docker save my-judge | gzip > my-judge.tar.gz
```

Then upload `my-judge.tar.gz` on the problem's Advanced settings page (image
source = tarball). Or push to a registry and paste the reference instead.

## The contract

The platform mounts a `/workspace` directory and runs your image:

```
/workspace/submission/   student files (read this)
/workspace/meta.json     { submissionId, language, submissionFiles, resourceLimits }
/workspace/output/       you write here
    result.json          required
```

Environment variables `SUBMISSION_ID` and `LANGUAGE` are also injected.

**Runtime constraints** — the container runs with `--network none` and a
read-only root filesystem. You may write only to `/workspace` and `/tmp`.
Anything you need at runtime (pip packages, testcases) must be baked into the
image at build time; nothing can be fetched while judging. Don't rely on the
process exit code to signal a verdict — only `result.json` is read.

**Protecting your answers** — the student program runs _inside this same
image_, as the same user. There is no strong filesystem isolation between your
grader and the submission: a malicious program can read any world-readable
path, including the baked-in `testcases/`. `run_submission` runs the student
from a clean temp working dir, but that only avoids relative-path collisions —
it is **not** a security boundary. The safe pattern (used by `grader.py`) is to
feed each case's input on **stdin** and compare the student's **stdout** to the
expected answer _inside the grader_, so the student never needs the answer.
Never hand the student program a path to the expected output, and don't bake
secrets at guessable readable paths if you run untrusted code.

## result.json shape

`nojv_grader.write_result(...)` produces this for you:

```jsonc
{
  "score": 85, // 0..100
  "verdict": "wrong_answer", // accepted | wrong_answer | time_limit_exceeded
  //          | memory_limit_exceeded | runtime_error | compile_error
  "feedback": "5/6 passed", // optional
  "testcases": [
    // optional per-case detail; verdict is AC | WA | TLE | MLE | RE | SE
    { "index": 0, "verdict": "AC", "runtimeMs": 23 },
  ],
}
```
