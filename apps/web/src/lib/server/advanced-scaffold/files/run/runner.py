"""runner.py — EDIT THIS FILE. It runs the student program in the RUN phase.

This is the untrusted half of the split: it executes the student's code against
the baked-in INPUTS and writes whatever the program produced into
/workspace/output/. It holds NO answers and makes NO grading decision — the
grade phase does that. Keep it that way: never bake answers into the run image.

Worked example: feed each case's stdin to the student program and save its raw
stdout as case-NN.out, plus a run.json status summarizing what happened.
"""

import json
from pathlib import Path

import nojv_runner as nojv

# Inputs are baked into the run image (see Dockerfile). They are NOT secret —
# the student is allowed to see them — so it is fine that the student program
# shares this container with them.
TESTCASES_DIR = Path("/testcases")
PER_CASE_TIMEOUT_S = 5.0

# --- EDIT HERE: how to compile / invoke the student program ----------------
# meta.json -> language lets you dispatch. The submission lives in submission/.
# For a Python full-source problem the entry point is main.py.
RUN_CMD = ["python", "main.py"]
# For a compiled language, compile first, e.g.:
#   c = nojv.compile_submission(["gcc", "main.c", "-O2", "-o", "main"])
#   if c.returncode != 0:
#       nojv.write_status({"compile_error": c.stderr.decode("utf-8", "replace")})
#       return
#   RUN_CMD = ["./main"]
# ---------------------------------------------------------------------------


def main():
    cases = sorted(TESTCASES_DIR.glob("case-*.in"))
    statuses = []

    for case_file in cases:
        name = case_file.stem  # "case-01"
        stdin = case_file.read_bytes()

        run = nojv.run_submission(RUN_CMD, stdin=stdin, timeout=PER_CASE_TIMEOUT_S)

        # Persist the student's raw stdout for the grade phase to compare.
        nojv.write_output(f"{name}.out", run.stdout)

        # Tell the grade phase what happened beyond the bytes (timeout / crash).
        statuses.append(
            {
                "case": name,
                "timed_out": run.timed_out,
                "returncode": run.returncode,
            }
        )

    nojv.write_status({"cases": statuses})


if __name__ == "__main__":
    main()
