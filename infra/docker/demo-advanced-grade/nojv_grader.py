"""nojv_grader — helper library for the NOJV advanced-mode GRADE image.

You should NOT need to edit this file. It hides the boring parts of the grade
container contract: reading the run phase's outputs + meta.json and writing a
schema-valid result.json. Edit grader.py instead.

THE GRADE CONTAINER IS TRUSTED AND RUNS NO STUDENT CODE. It is the only place
the answers live (baked into the image at /answers). It reads the run phase's
sanitized outputs (mounted read-only at /workspace/run-output) and the answers,
compares them, and writes the final verdict. Because no student code runs here,
the answers can never leak. The grade container has FULL network (trusted TA).
"""

import json
from pathlib import Path

WORKSPACE = Path("/workspace")
RUN_OUTPUT_DIR = WORKSPACE / "run-output"
META_PATH = WORKSPACE / "meta.json"
OUTPUT_PATH = WORKSPACE / "output" / "result.json"

# Canonical top-level verdicts the platform accepts, and the short codes used
# for per-testcase detail. write_result() validates against these so a typo
# can't produce a result.json the platform rejects (which would score 0).
TOP_VERDICTS = (
    "accepted",
    "wrong_answer",
    "time_limit_exceeded",
    "memory_limit_exceeded",
    "runtime_error",
    "compile_error",
)
CASE_VERDICTS = ("AC", "WA", "TLE", "MLE", "RE", "SE")
_TOP_ALIASES = {
    "ac": "accepted",
    "wa": "wrong_answer",
    "tle": "time_limit_exceeded",
    "mle": "memory_limit_exceeded",
    "re": "runtime_error",
    "ce": "compile_error",
}


def load_meta():
    """Return grade meta.json: {submissionId, language, runStatus}.

    runStatus = the worker-observed run-container outcome:
      { "state": "exited" | "timed_out" | "oom_killed", "exitCode": int|null }
    Use it to emit a whole-submission TLE/MLE/RE when the run container died
    catastrophically; ordinary per-case verdicts you decide from the outputs.
    """
    return json.loads(META_PATH.read_text())


def language():
    """Submission language, e.g. 'python', 'cpp'."""
    return load_meta().get("language", "")


def run_status():
    """The run-container outcome dict (see load_meta)."""
    return load_meta().get("runStatus", {}) or {}


def run_output(name):
    """Read one run-phase output artifact by relative name, as RAW BYTES.

    Returns b'' if the student produced nothing for this name — an empty output
    is a legitimate outcome (render WA/RE), not an error.
    """
    target = RUN_OUTPUT_DIR / name
    return target.read_bytes() if target.is_file() else b""


def run_json():
    """Read /workspace/run-output/run.json if the run harness wrote one, else {}."""
    target = RUN_OUTPUT_DIR / "run.json"
    if not target.is_file():
        return {}
    try:
        return json.loads(target.read_text())
    except (ValueError, OSError):
        return {}


def answer(name):
    """Read one baked-in answer by relative name, as RAW BYTES (from /answers)."""
    return (Path("/answers") / name).read_bytes()


def fatal_run_verdict():
    """If the run container died catastrophically, the matching top verdict, else None.

    Lets grader.py short-circuit: a worker-observed timeout/OOM is a
    whole-submission TLE/MLE regardless of partial outputs.
    """
    state = run_status().get("state")
    if state == "timed_out":
        return "time_limit_exceeded"
    if state == "oom_killed":
        return "memory_limit_exceeded"
    return None


def _normalize_top(verdict):
    v = str(verdict).strip().lower()
    v = _TOP_ALIASES.get(v, v)
    if v not in TOP_VERDICTS:
        raise ValueError(f"invalid verdict {verdict!r}; expected one of {TOP_VERDICTS}")
    return v


def _normalize_case(verdict):
    v = str(verdict).strip().upper()
    if v not in CASE_VERDICTS:
        raise ValueError(
            f"invalid testcase verdict {verdict!r}; expected one of {CASE_VERDICTS}"
        )
    return v


def write_result(score, verdict, feedback="", testcases=None):
    """Write /workspace/output/result.json in the platform's canonical shape.

    score: clamped to 0..100.
    verdict: canonical long form (accepted, wrong_answer, ...); short codes
             (AC, WA, ...) and 'ce' are accepted and normalized.
    testcases: optional list of {index, verdict, runtimeMs?, feedback?} where
               verdict is a short code (AC/WA/TLE/MLE/RE/SE).
    """
    result = {
        "score": max(0, min(100, round(score))),
        "verdict": _normalize_top(verdict),
    }
    if feedback:
        result["feedback"] = str(feedback)[:10_000]
    if testcases:
        cases = []
        for i, tc in enumerate(testcases):
            case = {
                "index": int(tc.get("index", i)),
                "verdict": _normalize_case(tc["verdict"]),
            }
            if tc.get("runtimeMs") is not None:
                case["runtimeMs"] = int(tc["runtimeMs"])
            if tc.get("feedback"):
                case["feedback"] = str(tc["feedback"])[:4_000]
            cases.append(case)
        result["testcases"] = cases

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(result))
    return result
