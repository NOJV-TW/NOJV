"""runner.py — the RUN phase of the NOJV advanced-mode DEMO problem.

This is the untrusted half of the split: it executes the student's `main.py`
against the baked-in INPUTS and writes whatever the program produced into
/workspace/output/. It holds NO answers and makes NO grading decision — the
grade phase (demo-advanced-grade) does that. Never bake answers into this image.

The demo problem is "read two space-separated ints from stdin, print their sum".
For each baked case-NN.in we feed it to `python main.py` and save the raw stdout
as case-NN.out, plus a run.json status summarizing what happened.
"""

from pathlib import Path

import nojv_runner as nojv

TESTCASES_DIR = Path("/testcases")
PER_CASE_TIMEOUT_S = 5.0

RUN_CMD = ["python", "main.py"]


def main():
    cases = sorted(TESTCASES_DIR.glob("case-*.in"))
    statuses = []

    for case_file in cases:
        name = case_file.stem  # "case-01"
        stdin = case_file.read_bytes()

        run = nojv.run_submission(RUN_CMD, stdin=stdin, timeout=PER_CASE_TIMEOUT_S)

        nojv.write_output(f"{name}.out", run.stdout)

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
