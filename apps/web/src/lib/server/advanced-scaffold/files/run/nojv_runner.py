"""nojv_runner — helper library for the NOJV advanced-mode RUN image.

You should NOT need to edit this file. It hides the boring parts of the run
container contract: reading the submission + meta.json and running the student
program. Edit runner.py instead.

THE RUN CONTAINER IS THE ONLY CONTAINER THAT EXECUTES UNTRUSTED STUDENT CODE.
It holds NO answers — those live only in the grade image. Your job here is to
run the student program against the baked-in INPUTS and write whatever the
student produced into /workspace/output/. The separate grade phase reads those
outputs and compares them to the answers. So you never have to (and must never)
bake answers into this image.

The platform mounts /workspace and runs this image with:
  - a non-root user (uid 10001), --cap-drop ALL, no-new-privileges
  - a read-only root filesystem (you may only write to /workspace and /tmp)
  - at most ONE network peer, selected per-problem (see README):
      none      -> no network at all
      allowlist -> HTTP_PROXY / HTTPS_PROXY point at the platform egress proxy;
                   the student program reaches allowlisted public hosts through it
      service   -> a TA service container is reachable at $NOJV_SERVICE_HOST
"""

import json
import os
import subprocess
from pathlib import Path

WORKSPACE = Path("/workspace")
SUBMISSION_DIR = WORKSPACE / "submission"
META_PATH = WORKSPACE / "meta.json"
OUTPUT_DIR = WORKSPACE / "output"


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


def service_host():
    """In `service` network mode, the TA service base URL (host:port). Empty otherwise."""
    return os.environ.get("NOJV_SERVICE_HOST", "")


def output_dir():
    """The directory you write per-case outputs into (created if missing)."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUTPUT_DIR


def compile_submission(cmd, cwd=None):
    """Run a compile command (e.g. ['gcc', 'main.c', '-o', 'main']).

    Returns a _RunResult; check .returncode. On failure, write a 'compile_error'
    marker the grade phase can read (see runner.py) — do NOT raise, so the grade
    phase still produces a verdict.
    """
    return _spawn(cmd, stdin=b"", timeout=None, cwd=cwd or str(SUBMISSION_DIR))


def run_submission(cmd, stdin=b"", timeout=None, cwd=None):
    """Run the student program for one case and capture its output.

    `cmd` is a list like ["python", "main.py"] or ["./main"]. `stdin` may be
    bytes (binary-safe) or str. Returns a _RunResult with .stdout/.stderr as
    RAW BYTES, plus .returncode and a .timed_out flag. The command runs with
    SUBMISSION_DIR as its cwd by default.

    Binary I/O: stdout is captured as bytes, so an image/audio-producing program
    round-trips losslessly when you write run.stdout straight to /workspace/output/.
    """
    return _spawn(cmd, stdin=stdin, timeout=timeout, cwd=cwd or str(SUBMISSION_DIR))


def _spawn(cmd, stdin, timeout, cwd):
    data = stdin.encode("utf-8") if isinstance(stdin, str) else (stdin or b"")
    try:
        proc = subprocess.run(
            cmd,
            input=data,
            capture_output=True,
            timeout=timeout,
            cwd=cwd,
        )
        return _RunResult(proc.stdout, proc.stderr, proc.returncode, False)
    except subprocess.TimeoutExpired as exc:
        return _RunResult(exc.stdout or b"", exc.stderr or b"", None, True)
    except FileNotFoundError:
        return _RunResult(b"", b"command not found", 127, False)


class _RunResult:
    def __init__(self, stdout, stderr, returncode, timed_out):
        self.stdout = stdout if isinstance(stdout, (bytes, bytearray)) else str(stdout).encode()
        self.stderr = stderr if isinstance(stderr, (bytes, bytearray)) else str(stderr).encode()
        self.returncode = returncode
        self.timed_out = timed_out


def write_output(name, data):
    """Write one output artifact into /workspace/output/<name> (bytes or str)."""
    target = output_dir() / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        data = data.encode("utf-8")
    target.write_bytes(data)


def write_status(status):
    """Write /workspace/output/run.json — a small per-run status the grade phase reads.

    Use this to convey per-case outcomes the grade phase can't infer from the
    output bytes alone (e.g. which case timed out, a compile_error marker).
    Shape is up to your run/grade pair; the platform does not interpret it.
    """
    (output_dir() / "run.json").write_text(json.dumps(status))
