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
