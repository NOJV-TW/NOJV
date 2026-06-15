import sys as _sys, os as _os
judge_input = open(_sys.argv[1]).read()
judge_answer = open(_sys.argv[2]).read()
feedback_dir = _sys.argv[3]
team_output = _sys.stdin.read()

def _write(name, text):
    with open(_os.path.join(feedback_dir, name), "w") as f:
        f.write(str(text))

def judge_log(msg):
    _write("judgemessage.txt", msg)

def accept(team_msg=""):
    if team_msg: _write("teammessage.txt", team_msg)
    _sys.exit(42)

def wrong(team_msg=""):
    if team_msg: _write("teammessage.txt", team_msg)
    _sys.exit(43)

# --- your code below ---
