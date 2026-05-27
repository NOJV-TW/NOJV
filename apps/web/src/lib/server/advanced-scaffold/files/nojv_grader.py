"""nojv_grader — helper library for NOJV advanced-mode judge images.

You should NOT need to edit this file. It hides the boring parts of the
container contract: reading the submission + meta.json, running the student
program safely, and writing a schema-valid result.json. Edit grader.py
instead.

The platform mounts /workspace and runs this image with --network none and a
read-only rootfs; you may only write to /workspace and /tmp.
"""

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

WORKSPACE = Path("/workspace")
SUBMISSION_DIR = WORKSPACE / "submission"
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
    """Return meta.json: {submissionId, language, submissionFiles, resourceLimits}."""
    return json.loads(META_PATH.read_text())


def submission_files():
    """Relative paths the platform wrote into submission/ for this run."""
    return list(load_meta().get("submissionFiles", []))


def submission_path(rel):
    """Absolute path to a file inside submission/ by its relative path."""
    return SUBMISSION_DIR / rel


def language():
    """Submission language, e.g. 'python', 'cpp'. Also in $LANGUAGE."""
    return load_meta().get("language", os.environ.get("LANGUAGE", ""))


def run_submission(cmd, stdin="", timeout=None, cwd=None):
    """Run the student program and capture stdout/stderr/exit/timed_out.

    The student files are copied into a fresh temp dir under /tmp and the
    command runs THERE — never from /grader. This is deliberate: /grader holds
    the baked-in testcases/, and running the student program from a directory
    that exposes those files would let a submission read the expected answers.

    `cmd` is a list like ["python", "main.py"]; relative paths resolve against
    the copied submission. Returns an object with .stdout/.stderr/.returncode
    and a .timed_out flag.
    """
    run_dir = tempfile.mkdtemp(prefix="nojv-sub-", dir="/tmp")
    try:
        if SUBMISSION_DIR.exists():
            shutil.copytree(SUBMISSION_DIR, run_dir, dirs_exist_ok=True)
        try:
            proc = subprocess.run(
                cmd,
                input=stdin,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd or run_dir,
            )
            return _RunResult(proc.stdout, proc.stderr, proc.returncode, False)
        except subprocess.TimeoutExpired as exc:
            return _RunResult(exc.stdout or "", exc.stderr or "", None, True)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)


class _RunResult:
    def __init__(self, stdout, stderr, returncode, timed_out):
        self.stdout = stdout if isinstance(stdout, str) else (stdout or b"").decode("utf-8", "replace")
        self.stderr = stderr if isinstance(stderr, str) else (stderr or b"").decode("utf-8", "replace")
        self.returncode = returncode
        self.timed_out = timed_out


def _normalize_top(verdict):
    v = str(verdict).strip().lower()
    v = _TOP_ALIASES.get(v, v)
    if v not in TOP_VERDICTS:
        raise ValueError(
            f"invalid verdict {verdict!r}; expected one of {TOP_VERDICTS}"
        )
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
