// Runnable example bodies shown inside the JudgeTab documentation panel.
// The Python examples show only the user-authored body — the sandbox
// auto-prepends the wrapper that defines `judge_input`, `judge_output`,
// `process_output`, `accept`, `reject`, `partial`, `read`, and `write`.

export const PYTHON_CHECKER_EXAMPLE = `# Available: judge_input, judge_output, process_output (strings)
# Helpers: accept(feedback=""), reject(feedback=""), partial(score, feedback="")

u = process_output.split()
e = judge_output.split()
if len(u) != len(e):
    reject("token count mismatch")
for a, b in zip(u, e):
    if abs(float(a) - float(b)) > 1e-6:
        reject(f"differ: got {a}, expected {b}")
accept()
`;

export const PYTHON_INTERACTOR_EXAMPLE = `# Available: judge_input (string), read(), write(msg)
# Helpers: accept(feedback="", score=100), reject(feedback="", score=0), partial(score, feedback="")

secret = int(judge_input.strip())
for i in range(1, 21):
    g = int(read())
    if g == secret:
        partial(max(0, 100 - (i - 1) * 5), f"correct in {i} guesses")
    write("higher" if secret > g else "lower")
reject("exceeded 20 guesses")
`;

export const CPP_CHECKER_EXAMPLE = `#include "testlib.h"

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    int n = inf.readInt();
    for (int i = 0; i < n; i++) {
        double expected = ans.readDouble();
        double got = ouf.readDouble();
        if (std::abs(expected - got) > 1e-6)
            quitf(_wa, "value %d differs: expected %.6f, got %.6f", i, expected, got);
    }
    quitf(_ok, "all %d values match", n);
}
`;

export const CPP_INTERACTOR_EXAMPLE = `#include "testlib.h"

int main(int argc, char* argv[]) {
    registerInteraction(argc, argv);
    int secret = inf.readInt();
    for (int guess_count = 1; guess_count <= 20; guess_count++) {
        int g;
        if (!(std::cin >> g)) quitf(_wa, "student closed stream early");
        if (g == secret) {
            int score = std::max(0, 100 - (guess_count - 1) * 5);
            quitp(score, "correct in %d guesses", guess_count);
        }
        std::cout << (secret > g ? "higher" : "lower") << std::endl;
    }
    quitf(_wa, "exceeded 20 guesses");
}
`;
