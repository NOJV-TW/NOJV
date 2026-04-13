import sys as _sys
judge_input = open(_sys.argv[1]).read()
judge_output = open(_sys.argv[2]).read()
process_output = open(_sys.argv[3]).read()

def accept(feedback=""):
    if feedback: print(feedback, file=_sys.stderr)
    _sys.exit(0)

def reject(feedback=""):
    if feedback: print(feedback, file=_sys.stderr)
    _sys.exit(1)

def partial(score, feedback=""):
    print(int(score))
    if feedback: print(feedback, file=_sys.stderr)
    _sys.exit(0 if score >= 100 else 1)

# --- your code below ---
