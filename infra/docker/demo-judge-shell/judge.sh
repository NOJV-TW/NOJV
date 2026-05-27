#!/bin/bash
# Demo Advanced Mode judge for the Shell Scripting Lab problem.
#
# Contract (see apps/worker/src/services/advanced-mode-executor.ts):
#   - The uploaded files live under /workspace/submission/.
#   - We must write /workspace/output/result.json matching advancedResultSchema:
#       { "score": 0-100, "verdict": "accepted"|"wrong_answer"|"runtime_error"|..., "feedback"?: string }
#
# Grading: run the submitted main.sh. If it runs and its stdout contains the
# token "hello", accept; otherwise wrong_answer. If main.sh is missing, runtime_error.
set -u

OUT_DIR=/workspace/output
SUBMISSION=/workspace/submission/main.sh
mkdir -p "$OUT_DIR"

write_result() {
  # $1 = score, $2 = verdict, $3 = feedback
  printf '{"score":%s,"verdict":"%s","feedback":"%s"}\n' "$1" "$2" "$3" > "$OUT_DIR/result.json"
}

if [ ! -f "$SUBMISSION" ]; then
  write_result 0 runtime_error "No main.sh found under /workspace/submission/."
  exit 0
fi

SCRIPT_OUTPUT="$(bash "$SUBMISSION" 2>&1)"
RUN_STATUS=$?

if [ "$RUN_STATUS" -ne 0 ]; then
  write_result 0 runtime_error "main.sh exited with status $RUN_STATUS."
  exit 0
fi

if printf '%s' "$SCRIPT_OUTPUT" | grep -q "hello"; then
  write_result 100 accepted "Script ran and printed the expected token."
else
  write_result 0 wrong_answer "Script ran but stdout did not contain the token 'hello'."
fi
