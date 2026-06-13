#!/bin/bash
set -u

OUT_DIR=/workspace/output
SUBMISSION=/workspace/submission/main.sh
mkdir -p "$OUT_DIR"

write_result() {
  local score="$1"
  local verdict="$2"
  local feedback="$3"
  printf '{"score":%s,"verdict":"%s","feedback":"%s"}\n' "$score" "$verdict" "$feedback" > "$OUT_DIR/result.json"
  return
}

if [[ ! -f "$SUBMISSION" ]]; then
  write_result 0 runtime_error "No main.sh found under /workspace/submission/."
  exit 0
fi

SCRIPT_OUTPUT="$(bash "$SUBMISSION" 2>&1)"
RUN_STATUS=$?

if [[ "$RUN_STATUS" -ne 0 ]]; then
  write_result 0 runtime_error "main.sh exited with status $RUN_STATUS."
  exit 0
fi

if printf '%s' "$SCRIPT_OUTPUT" | grep -q "hello"; then
  write_result 100 accepted "Script ran and printed the expected token."
else
  write_result 0 wrong_answer "Script ran but stdout did not contain the token 'hello'."
fi
