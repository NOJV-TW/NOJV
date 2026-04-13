import sys as _sys
judge_input = open(_sys.argv[1]).read()

def read():
    line = _sys.stdin.readline()
    if not line: _emit(0, "student closed stream early", 1)
    return line.rstrip("\n")

def write(msg):
    print(msg, flush=True)

def accept(feedback="", score=100):
    _emit(score, feedback, 0)

def reject(feedback="", score=0):
    _emit(score, feedback, 1)

def partial(score, feedback=""):
    _emit(score, feedback, 0 if score >= 100 else 1)

def _emit(score, feedback, code):
    print(int(score), file=_sys.stderr)
    if feedback: print(feedback, file=_sys.stderr)
    _sys.exit(code)

# --- your code below ---
