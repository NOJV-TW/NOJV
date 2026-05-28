import sys as _sys, os as _os
judge_input = open(_sys.argv[1]).read()
judge_answer = open(_sys.argv[2]).read()
feedback_dir = _sys.argv[3]

def read():
    line = _sys.stdin.readline()
    if not line: wrong("solution closed its output early")
    return line.rstrip("\n")

def write(msg):
    print(msg, flush=True)

def _write(name, text):
    with open(_os.path.join(feedback_dir, name), "w") as f:
        f.write(str(text))

def set_score(x):
    _write("score.txt", x)

def judge_log(msg):
    _write("judgemessage.txt", msg)

def accept(team_msg=""):
    if team_msg: _write("teammessage.txt", team_msg)
    _sys.exit(42)

def wrong(team_msg=""):
    if team_msg: _write("teammessage.txt", team_msg)
    _sys.exit(43)

# --- your code below ---
