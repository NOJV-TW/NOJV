type SeedLanguage = "python" | "cpp" | "c";

type SourceFile = { path: string; content: string };

type Solution = {
  sourceCode?: string;
  sourceFiles?: SourceFile[];
};

type WrongSolution = Solution & {
  expectVerdict: "WA" | "TLE" | "RE";
};

export type SeedSolution = {
  language: SeedLanguage;
  correct: Solution;
  wrong: WrongSolution;
};

const SUM_CORRECT = `import sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    a, b = map(int, line.split())
    print(a + b)
`;

const SUM_WRONG = `import sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    a, b = map(int, line.split())
    print(a * b)
`;

const BSEARCH_CORRECT = `import sys, bisect
data = sys.stdin.read().split()
i = 0
n = int(data[i]); i += 1
arr = [int(data[i + k]) for k in range(n)]; i += n
q = int(data[i]); i += 1
queries = [int(data[i + k]) for k in range(q)]
print(" ".join(str(bisect.bisect_left(arr, x)) for x in queries))
`;

const BSEARCH_WRONG = `import sys
data = sys.stdin.read().split()
i = 0
n = int(data[i]); i += 1
arr = [int(data[i + k]) for k in range(n)]; i += n
q = int(data[i]); i += 1
queries = [int(data[i + k]) for k in range(q)]
out = []
for x in queries:
    idx = -1
    for j, v in enumerate(arr):
        if v == x:
            idx = j
            break
    out.append(str(idx))
print(" ".join(out))
`;

const BFS_CORRECT = `import sys
from collections import deque
data = sys.stdin.read().splitlines()
R, C = map(int, data[0].split())
grid = data[1 : 1 + R]
if grid[0][0] == "#" or grid[R - 1][C - 1] == "#":
    print(-1)
else:
    dist = [[-1] * C for _ in range(R)]
    dist[0][0] = 0
    q = deque([(0, 0)])
    while q:
        r, c = q.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] == "." and dist[nr][nc] < 0:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    print(dist[R - 1][C - 1])
`;

const BFS_WRONG = `import sys
data = sys.stdin.read().splitlines()
R, C = map(int, data[0].split())
print((R - 1) + (C - 1))
`;

const KADANE_CORRECT = `import sys
data = sys.stdin.read().split()
n = int(data[0])
a = [int(x) for x in data[1 : 1 + n]]
best = cur = a[0]
for x in a[1:]:
    cur = max(x, cur + x)
    best = max(best, cur)
print(best)
`;

const KADANE_WRONG = `import sys
data = sys.stdin.read().split()
n = int(data[0])
a = [int(x) for x in data[1 : 1 + n]]
print(sum(a))
`;

const KNAPSACK_CORRECT = `import sys
data = sys.stdin.read().split()
n = int(data[0]); W = int(data[1])
i = 2
items = []
for _ in range(n):
    w = int(data[i]); v = int(data[i + 1]); i += 2
    items.append((w, v))
dp = [0] * (W + 1)
for w, v in items:
    for c in range(W, w - 1, -1):
        if dp[c - w] + v > dp[c]:
            dp[c] = dp[c - w] + v
print(dp[W])
`;

const KNAPSACK_WRONG = `import sys
data = sys.stdin.read().split()
n = int(data[0]); W = int(data[1])
i = 2
items = []
for _ in range(n):
    w = int(data[i]); v = int(data[i + 1]); i += 2
    items.append((w, v))
items.sort(key=lambda it: it[1] / it[0], reverse=True)
total = 0
cap = W
for w, v in items:
    if w <= cap:
        cap -= w
        total += v
print(total)
`;

const FLOAT_CORRECT = `a, b = map(int, input().split())
print(f"{a / b:.6f}")
`;

const FLOAT_WRONG = `a, b = map(int, input().split())
print(f"{b / a:.6f}")
`;

const ANY_TWO_SUM_CORRECT = `import sys
data = sys.stdin.read().split("\\n")
n, target = map(int, data[0].split())
arr = list(map(int, data[1].split()))
seen = {}
ans = "-1"
for idx, value in enumerate(arr):
    need = target - value
    if need in seen:
        ans = f"{seen[need] + 1} {idx + 1}"
        break
    if value not in seen:
        seen[value] = idx
print(ans)
`;

const ANY_TWO_SUM_WRONG = `print("1 1")
`;

const INTERACTIVE_GUESS_CORRECT = `import sys
lo, hi = map(int, sys.stdin.readline().split())
while lo <= hi:
    mid = (lo + hi) // 2
    print(mid, flush=True)
    resp = sys.stdin.readline().strip()
    if resp == "correct":
        break
    elif resp == "higher":
        lo = mid + 1
    elif resp == "lower":
        hi = mid - 1
    else:
        break
`;

const INTERACTIVE_GUESS_WRONG = `import sys
sys.stdin.readline()
for _ in range(64):
    print(0, flush=True)
    resp = sys.stdin.readline().strip()
    if resp == "correct":
        break
`;

const NOISY_ORACLE_CORRECT = `import sys
lo, hi, max_turns, lie_period = map(int, sys.stdin.readline().split())
for turn in range(1, max_turns + 1):
    mid = (lo + hi) // 2
    print(mid, flush=True)
    resp = sys.stdin.readline().strip()
    if resp == "correct":
        break
    if turn % lie_period == 0:
        resp = "lower" if resp == "higher" else "higher"
    if resp == "higher":
        lo = mid + 1
    else:
        hi = mid - 1
`;

const NOISY_ORACLE_WRONG = `import sys
lo, hi, max_turns, lie_period = map(int, sys.stdin.readline().split())
for turn in range(1, max_turns + 1):
    mid = (lo + hi) // 2
    print(mid, flush=True)
    resp = sys.stdin.readline().strip()
    if resp == "correct":
        break
    if resp == "higher":
        lo = mid + 1
    else:
        hi = mid - 1
`;

const IS_PRIME_CORRECT = `from iolib import read_queries

def is_prime(n: int) -> bool:
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True

def main() -> None:
    for n in read_queries():
        print("YES" if is_prime(n) else "NO")

if __name__ == "__main__":
    main()
`;

const IS_PRIME_WRONG = `from iolib import read_queries

def is_prime(n: int) -> bool:
    return n % 2 == 1

def main() -> None:
    for n in read_queries():
        print("YES" if is_prime(n) else "NO")

if __name__ == "__main__":
    main()
`;

const MF_BINARY_SEARCH_CORRECT = `from typing import List

from iolib import read_problem

def binary_search(arr: List[int], x: int) -> int:
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == x:
            return mid
        if arr[mid] < x:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

def main() -> None:
    arr, queries = read_problem()
    print(" ".join(str(binary_search(arr, x)) for x in queries))

if __name__ == "__main__":
    main()
`;

const MF_BINARY_SEARCH_WRONG = `from typing import List

from iolib import read_problem

def binary_search(arr: List[int], x: int) -> int:
    return 0

def main() -> None:
    arr, queries = read_problem()
    print(" ".join(str(binary_search(arr, x)) for x in queries))

if __name__ == "__main__":
    main()
`;

const FACTOR_PAIR_CORRECT = `from typing import Tuple

from numio import read_n

def any_factor_pair(n: int) -> Tuple[int, int]:
    i = 2
    while i * i <= n:
        if n % i == 0:
            return (i, n // i)
        i += 1
    return (1, n)

def main() -> None:
    a, b = any_factor_pair(read_n())
    print(a, b)

if __name__ == "__main__":
    main()
`;

const FACTOR_PAIR_WRONG = `from typing import Tuple

from numio import read_n

def any_factor_pair(n: int) -> Tuple[int, int]:
    return (1, n)

def main() -> None:
    a, b = any_factor_pair(read_n())
    print(a, b)

if __name__ == "__main__":
    main()
`;

const MF_BISECT_CORRECT = `from proto import read_range, read_verdict, send_guess

def main() -> None:
    lo, hi = read_range()
    while lo <= hi:
        mid = (lo + hi) // 2
        send_guess(mid)
        verdict = read_verdict()
        if verdict == "correct":
            return
        if verdict == "higher":
            lo = mid + 1
        elif verdict == "lower":
            hi = mid - 1
        else:
            return

if __name__ == "__main__":
    main()
`;

const MF_BISECT_WRONG = `from proto import read_range, read_verdict, send_guess

def main() -> None:
    read_range()
    for _ in range(64):
        send_guess(0)
        if read_verdict() == "correct":
            return

if __name__ == "__main__":
    main()
`;

const ADVANCED_SUM_CORRECT = `import sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    a, b = map(int, line.split())
    print(a + b)
`;

const ADVANCED_SUM_WRONG = `import sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    a, b = map(int, line.split())
    print(a * b)
`;

const PALINDROME_CORRECT = `s = input().strip()
print("Yes" if s == s[::-1] else "No")
`;

const PALINDROME_WRONG = `input()
print("Yes")
`;

const FIB_CORRECT = `n = int(input())
a, b = 0, 1
for _ in range(n):
    a, b = b, a + b
print(a)
`;

const FIB_WRONG = `n = int(input())
a, b = 0, 1
for _ in range(n):
    a, b = b, a + b
print(b)
`;

const SORT_UNIQUE_CORRECT = `import sys
data = sys.stdin.read().split()
n = int(data[0])
vals = sorted(set(int(x) for x in data[1 : 1 + n]))
print(" ".join(str(v) for v in vals))
`;

const SORT_UNIQUE_WRONG = `import sys
data = sys.stdin.read().split()
n = int(data[0])
vals = sorted(int(x) for x in data[1 : 1 + n])
print(" ".join(str(v) for v in vals))
`;

const GCD_CORRECT = `import math
a, b = map(int, input().split())
print(math.gcd(a, b))
`;

const GCD_WRONG = `a, b = map(int, input().split())
print(min(a, b))
`;

const BRACKETS_CORRECT = `s = input().strip()
pairs = {")": "(", "]": "[", "}": "{"}
st = []
ok = True
for ch in s:
    if ch in "([{":
        st.append(ch)
    elif not st or st.pop() != pairs[ch]:
        ok = False
        break
print("Yes" if ok and not st else "No")
`;

const BRACKETS_WRONG = `s = input().strip()
opens = sum(1 for c in s if c in "([{")
print("Yes" if opens * 2 == len(s) else "No")
`;

const GRID_BFS_CORRECT = `import sys
from collections import deque
data = sys.stdin.read().splitlines()
R, C = map(int, data[0].split())
grid = data[1 : 1 + R]
start = goal = None
for r in range(R):
    for c in range(C):
        if grid[r][c] == "S":
            start = (r, c)
        elif grid[r][c] == "G":
            goal = (r, c)
dist = [[-1] * C for _ in range(R)]
dist[start[0]][start[1]] = 0
q = deque([start])
while q:
    r, c = q.popleft()
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] != "#" and dist[nr][nc] < 0:
            dist[nr][nc] = dist[r][c] + 1
            q.append((nr, nc))
print(dist[goal[0]][goal[1]])
`;

const GRID_BFS_WRONG = `import sys
data = sys.stdin.read().splitlines()
R, C = map(int, data[0].split())
grid = data[1 : 1 + R]
s = g = None
for r in range(R):
    for c in range(C):
        if grid[r][c] == "S":
            s = (r, c)
        elif grid[r][c] == "G":
            g = (r, c)
print(abs(s[0] - g[0]) + abs(s[1] - g[1]))
`;

export const SEED_SOLUTIONS: Record<string, SeedSolution> = {
  "problem_warmup-sum": {
    language: "python",
    correct: { sourceCode: SUM_CORRECT },
    wrong: { sourceCode: SUM_WRONG, expectVerdict: "WA" },
  },
  "problem_add-two-numbers": {
    language: "python",
    correct: { sourceCode: SUM_CORRECT },
    wrong: { sourceCode: SUM_WRONG, expectVerdict: "WA" },
  },
  "problem_graph-docking": {
    language: "python",
    correct: { sourceCode: BSEARCH_CORRECT },
    wrong: { sourceCode: BSEARCH_WRONG, expectVerdict: "WA" },
  },
  "problem_distributed-labyrinth": {
    language: "python",
    correct: { sourceCode: BFS_CORRECT },
    wrong: { sourceCode: BFS_WRONG, expectVerdict: "WA" },
  },
  "problem_process-log-parser": {
    language: "python",
    correct: { sourceCode: KADANE_CORRECT },
    wrong: { sourceCode: KADANE_WRONG, expectVerdict: "WA" },
  },
  "problem_fork-bomb-safeguard": {
    language: "python",
    correct: { sourceCode: KNAPSACK_CORRECT },
    wrong: { sourceCode: KNAPSACK_WRONG, expectVerdict: "WA" },
  },
  "problem_float-compare": {
    language: "python",
    correct: { sourceCode: FLOAT_CORRECT },
    wrong: { sourceCode: FLOAT_WRONG, expectVerdict: "WA" },
  },
  "problem_any-two-sum": {
    language: "python",
    correct: { sourceCode: ANY_TWO_SUM_CORRECT },
    wrong: { sourceCode: ANY_TWO_SUM_WRONG, expectVerdict: "WA" },
  },
  "problem_guess-the-number": {
    language: "python",
    correct: { sourceCode: INTERACTIVE_GUESS_CORRECT },
    wrong: { sourceCode: INTERACTIVE_GUESS_WRONG, expectVerdict: "WA" },
  },
  "problem_noisy-oracle-hunt": {
    language: "python",
    correct: { sourceCode: NOISY_ORACLE_CORRECT },
    wrong: { sourceCode: NOISY_ORACLE_WRONG, expectVerdict: "WA" },
  },
  "problem_stateful-dhcp-parser": {
    language: "python",
    correct: { sourceFiles: [{ path: "main.py", content: IS_PRIME_CORRECT }] },
    wrong: {
      sourceFiles: [{ path: "main.py", content: IS_PRIME_WRONG }],
      expectVerdict: "WA",
    },
  },
  "problem_memory-leak-forensics": {
    language: "python",
    correct: { sourceFiles: [{ path: "main.py", content: MF_BINARY_SEARCH_CORRECT }] },
    wrong: {
      sourceFiles: [{ path: "main.py", content: MF_BINARY_SEARCH_WRONG }],
      expectVerdict: "WA",
    },
  },
  "problem_multi-checker-stats": {
    language: "python",
    correct: { sourceFiles: [{ path: "main.py", content: FACTOR_PAIR_CORRECT }] },
    wrong: {
      sourceFiles: [{ path: "main.py", content: FACTOR_PAIR_WRONG }],
      expectVerdict: "WA",
    },
  },
  "problem_multi-interactive-bisect": {
    language: "python",
    correct: { sourceFiles: [{ path: "main.py", content: MF_BISECT_CORRECT }] },
    wrong: {
      sourceFiles: [{ path: "main.py", content: MF_BISECT_WRONG }],
      expectVerdict: "WA",
    },
  },
  "problem_shell-scripting-lab": {
    language: "python",
    correct: { sourceFiles: [{ path: "main.py", content: ADVANCED_SUM_CORRECT }] },
    wrong: {
      sourceFiles: [{ path: "main.py", content: ADVANCED_SUM_WRONG }],
      expectVerdict: "WA",
    },
  },
  "problem_palindrome-check": {
    language: "python",
    correct: { sourceCode: PALINDROME_CORRECT },
    wrong: { sourceCode: PALINDROME_WRONG, expectVerdict: "WA" },
  },
  "problem_fibonacci-number": {
    language: "python",
    correct: { sourceCode: FIB_CORRECT },
    wrong: { sourceCode: FIB_WRONG, expectVerdict: "WA" },
  },
  "problem_max-subarray-kadane": {
    language: "python",
    correct: { sourceCode: KADANE_CORRECT },
    wrong: { sourceCode: KADANE_WRONG, expectVerdict: "WA" },
  },
  "problem_grid-bfs-steps": {
    language: "python",
    correct: { sourceCode: GRID_BFS_CORRECT },
    wrong: { sourceCode: GRID_BFS_WRONG, expectVerdict: "WA" },
  },
  "problem_sort-and-unique": {
    language: "python",
    correct: { sourceCode: SORT_UNIQUE_CORRECT },
    wrong: { sourceCode: SORT_UNIQUE_WRONG, expectVerdict: "WA" },
  },
  "problem_greatest-common-divisor": {
    language: "python",
    correct: { sourceCode: GCD_CORRECT },
    wrong: { sourceCode: GCD_WRONG, expectVerdict: "WA" },
  },
  "problem_balanced-brackets": {
    language: "python",
    correct: { sourceCode: BRACKETS_CORRECT },
    wrong: { sourceCode: BRACKETS_WRONG, expectVerdict: "WA" },
  },
  "problem_knapsack-01": {
    language: "python",
    correct: { sourceCode: KNAPSACK_CORRECT },
    wrong: { sourceCode: KNAPSACK_WRONG, expectVerdict: "WA" },
  },
};
