// Runnable example bodies shown inside the JudgeTab documentation panel.
// The Python examples show only the user-authored body — the sandbox
// auto-prepends a wrapper that binds `judge_input`, `judge_answer`,
// `team_output` (validator) / `read`, `write` (interactor), `feedback_dir`
// and the helpers `accept`, `wrong`, `set_score`, `judge_log`.

export const PYTHON_CHECKER_EXAMPLE = `# Bound: judge_input, judge_answer, team_output (strings)
# Helpers: accept(team_msg=""), wrong(team_msg=""), set_score(x), judge_log(msg)

u = team_output.split()
e = judge_answer.split()
if len(u) != len(e):
    wrong("token count mismatch")
for a, b in zip(u, e):
    if abs(float(a) - float(b)) > 1e-6:
        wrong(f"differ: got {a}, expected {b}")
accept()
`;

export const PYTHON_INTERACTOR_EXAMPLE = `# Bound: judge_input, judge_answer (strings); read(), write(msg)
# Helpers: accept(team_msg=""), wrong(team_msg=""), set_score(x), judge_log(msg)

secret = int(judge_input.strip())
for i in range(1, 21):
    g = int(read())
    if g == secret:
        set_score(max(0, 100 - (i - 1) * 5))
        accept(f"correct in {i} guesses")
    write("higher" if secret > g else "lower")
wrong("exceeded 20 guesses")
`;

export const CPP_CHECKER_EXAMPLE = `#include <cstdio>
#include <cmath>
#include <fstream>
#include <iostream>
#include <string>

// DOMjudge output validator: argv[1]=input, argv[2]=judge answer,
// argv[3]=feedback dir. Team output arrives on stdin. Exit 42 = accept,
// 43 = wrong; write feedback to <feedback_dir>/teammessage.txt.
int main(int argc, char* argv[]) {
    std::ifstream ans(argv[2]);
    std::string feedback_dir = argv[3];

    auto finish = [&](int code, const std::string& msg) {
        std::ofstream(feedback_dir + "/teammessage.txt") << msg;
        std::exit(code);
    };

    int n;
    if (!(ans >> n)) finish(43, "could not read judge answer");
    for (int i = 0; i < n; i++) {
        double expected, got;
        ans >> expected;
        if (!(std::cin >> got))
            finish(43, "team output ended early");
        if (std::abs(expected - got) > 1e-6)
            finish(43, "value " + std::to_string(i) + " differs");
    }
    finish(42, "all values match");
}
`;

export const CPP_INTERACTOR_EXAMPLE = `#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>

// DOMjudge interactor: argv[1]=input, argv[2]=judge answer,
// argv[3]=feedback dir. stdin reads from the solution, stdout writes to it.
// Exit 42 = accept, 43 = wrong; optional score in <feedback_dir>/score.txt.
int main(int argc, char* argv[]) {
    std::ifstream in(argv[1]);
    std::string feedback_dir = argv[3];

    auto finish = [&](int code, int score, const std::string& msg) {
        std::ofstream(feedback_dir + "/score.txt") << score;
        std::ofstream(feedback_dir + "/teammessage.txt") << msg;
        std::exit(code);
    };

    int secret;
    in >> secret;
    for (int guess_count = 1; guess_count <= 20; guess_count++) {
        int g;
        if (!(std::cin >> g)) finish(43, 0, "solution closed its output early");
        if (g == secret)
            finish(42, std::max(0, 100 - (guess_count - 1) * 5),
                   "correct in " + std::to_string(guess_count) + " guesses");
        std::cout << (secret > g ? "higher" : "lower") << std::endl;
    }
    finish(43, 0, "exceeded 20 guesses");
}
`;
