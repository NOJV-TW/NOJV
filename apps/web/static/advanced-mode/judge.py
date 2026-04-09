"""
Reference advanced-mode judge.

Reads /workspace/meta.json + /workspace/testcases/, runs whatever logic
your assignment needs, then writes /workspace/output/result.json that
matches the schema enforced by `advancedResultSchema` in @nojv/core.

Replace the dummy "always pass" logic with your real grading.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

WORKSPACE = Path("/workspace")
SUBMISSION_DIR = WORKSPACE / "submission"
TESTCASES_DIR = WORKSPACE / "testcases"
OUTPUT_DIR = WORKSPACE / "output"
META_PATH = WORKSPACE / "meta.json"


def load_meta() -> dict:
    if not META_PATH.exists():
        return {}
    return json.loads(META_PATH.read_text(encoding="utf-8"))


def list_testcase_indices() -> list[int]:
    if not TESTCASES_DIR.exists():
        return []
    indices = []
    for entry in sorted(TESTCASES_DIR.iterdir()):
        if entry.is_dir() and entry.name.isdigit():
            indices.append(int(entry.name))
    return sorted(indices)


def grade_testcase(index: int) -> dict:
    """Stub grader: pretend every testcase passes in 1ms."""
    return {
        "index": index,
        "verdict": "AC",
        "runtimeMs": 1,
        "feedback": "stub judge: replace this with real grading",
    }


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    meta = load_meta()
    sys.stderr.write(f"[judge] meta: {json.dumps(meta)}\n")

    files = list(SUBMISSION_DIR.glob("**/*")) if SUBMISSION_DIR.exists() else []
    sys.stderr.write(f"[judge] submission files: {len(files)}\n")

    indices = list_testcase_indices()
    sys.stderr.write(f"[judge] testcases: {len(indices)}\n")

    testcases = [grade_testcase(i) for i in indices]
    all_passed = all(tc["verdict"] == "AC" for tc in testcases) if testcases else True

    result = {
        "score": 100 if all_passed else 0,
        "verdict": "accepted" if all_passed else "wrong_answer",
        "feedback": "stub judge — replace /app/judge.py with real grading",
        "testcases": testcases,
    }

    (OUTPUT_DIR / "result.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
