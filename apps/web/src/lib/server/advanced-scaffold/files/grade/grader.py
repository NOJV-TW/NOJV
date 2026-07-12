"""grader.py — EDIT THIS FILE. It scores the submission in the GRADE phase.

This is the trusted half of the split: no student code runs here, so the answers
(baked into /answers) can never leak. It reads the run phase's outputs from
/workspace/run-output/, compares them to the answers, and writes the final
verdict to /workspace/output/result.json.

Worked example: for each case, compare the student's saved stdout (case-NN.out)
to the expected answer (case-NN.out under /answers), honoring the run phase's
per-case timeout/crash status.
"""

import nojv_grader as nojv


def main():
    # If the worker reported the whole run container timed out / OOM'd, that is
    # a whole-submission verdict regardless of any partial outputs.
    fatal = nojv.fatal_run_verdict()
    if fatal is not None:
        nojv.write_result(score=0, verdict=fatal, feedback="Run container exceeded its limits")
        return

    run = nojv.run_json()
    per_case = {c["case"]: c for c in run.get("cases", [])}

    cases = sorted(per_case.keys()) or ["case-01", "case-02"]
    testcases = []
    passed = 0

    for i, name in enumerate(cases):
        status = per_case.get(name, {})
        expected = nojv.answer(f"{name}.out")
        produced = nojv.run_output(f"{name}.out")

        # --- EDIT HERE: decide the per-case verdict ------------------------
        if status.get("timed_out"):
            verdict = "TLE"
        elif status.get("returncode") not in (0, None):
            verdict = "RE"
        elif produced.strip() == expected.strip():
            verdict = "AC"
        else:
            verdict = "WA"
        # -------------------------------------------------------------------

        if verdict == "AC":
            passed += 1
        testcases.append({"index": i, "verdict": verdict})

    total = len(cases)
    full = nojv.max_score()
    score = round(passed / total * full) if total else 0
    verdict = "accepted" if total and passed == total else "wrong_answer"

    nojv.write_result(
        score=score,
        verdict=verdict,
        feedback=f"{passed}/{total} testcases passed",
        testcases=testcases,
    )


if __name__ == "__main__":
    main()
