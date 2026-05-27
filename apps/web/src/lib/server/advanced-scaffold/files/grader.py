"""grader.py — EDIT THIS FILE to grade your problem.

This worked example runs the student's main.py against each testcase under
testcases/ and compares stdout to the expected output. The helper library
nojv_grader handles the container contract; you focus on grading.

Run flow: read testcases -> run submission per case -> compare -> score.
"""

import json
from pathlib import Path

import nojv_grader as nojv

TESTCASES_DIR = Path("/grader/testcases")

# --- EDIT HERE: how to invoke the student program -------------------------
# The submission files live in submission/ (see meta.json -> submissionFiles).
# For a Python full-source problem the entry point is main.py. Dispatch on
# nojv.language() if you accept multiple languages, or compile first.
RUN_CMD = ["python", "main.py"]
PER_CASE_TIMEOUT_S = 2.0
# --------------------------------------------------------------------------


def main():
    cases = sorted(TESTCASES_DIR.glob("case-*.json"))
    testcases = []
    passed = 0

    for i, case_file in enumerate(cases):
        case = json.loads(case_file.read_text())
        run = nojv.run_submission(
            RUN_CMD, stdin=case["stdin"], timeout=PER_CASE_TIMEOUT_S
        )

        # --- EDIT HERE: decide the per-case verdict ------------------------
        if run.timed_out:
            verdict = "TLE"
        elif run.returncode not in (0, None):
            verdict = "RE"
        elif run.stdout.strip() == case["expected"].strip():
            verdict = "AC"
        else:
            verdict = "WA"
        # -------------------------------------------------------------------

        if verdict == "AC":
            passed += 1
        testcases.append({"index": i, "verdict": verdict})

    total = len(cases)
    score = round(passed / total * 100) if total else 0
    verdict = "accepted" if total and passed == total else "wrong_answer"

    nojv.write_result(
        score=score,
        verdict=verdict,
        feedback=f"{passed}/{total} testcases passed",
        testcases=testcases,
    )


if __name__ == "__main__":
    main()
