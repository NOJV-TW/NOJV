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

const INTERVAL_SCHEDULING_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    intervals = []\n    idx = 1\n    for _ in range(n):\n        s = int(data[idx])\n        e = int(data[idx + 1])\n        idx += 2\n        intervals.append((e, s))\n    intervals.sort()\n    count = 0\n    current_end = -1\n    for e, s in intervals:\n        if s >= current_end:\n            count += 1\n            current_end = e\n    print(count)\n\n\nmain()\n";
const INTERVAL_SCHEDULING_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    intervals = []\n    idx = 1\n    for _ in range(n):\n        s = int(data[idx])\n        e = int(data[idx + 1])\n        idx += 2\n        intervals.append((s, e))\n    intervals.sort()\n    count = 0\n    current_end = -1\n    for s, e in intervals:\n        if s >= current_end:\n            count += 1\n            current_end = e\n    print(count)\n\n\nmain()\n";
const MIN_MERGE_COST_CORRECT =
  "import heapq\nimport sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    piles = [int(x) for x in data[1 : 1 + n]]\n    if n == 1:\n        print(0)\n        return\n    heapq.heapify(piles)\n    total = 0\n    while len(piles) > 1:\n        x = heapq.heappop(piles)\n        y = heapq.heappop(piles)\n        merged = x + y\n        total += merged\n        heapq.heappush(piles, merged)\n    print(total)\n\n\nmain()\n";
const MIN_MERGE_COST_WRONG =
  "import heapq\nimport sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    piles = [-int(x) for x in data[1 : 1 + n]]\n    if n == 1:\n        print(0)\n        return\n    heapq.heapify(piles)\n    total = 0\n    while len(piles) > 1:\n        x = heapq.heappop(piles)\n        y = heapq.heappop(piles)\n        merged = x + y\n        total += -merged\n        heapq.heappush(piles, merged)\n    print(total)\n\n\nmain()\n";
const PAIR_SUM_COUNT_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    t = int(data[1])\n    a = sorted(int(x) for x in data[2 : 2 + n])\n    i, j = 0, n - 1\n    count = 0\n    while i < j:\n        if a[i] + a[j] <= t:\n            count += j - i\n            i += 1\n        else:\n            j -= 1\n    print(count)\n\n\nmain()\n";
const PAIR_SUM_COUNT_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    t = int(data[1])\n    a = sorted(int(x) for x in data[2 : 2 + n])\n    i, j = 0, n - 1\n    count = 0\n    while i < j:\n        if a[i] + a[j] < t:\n            count += j - i\n            i += 1\n        else:\n            j -= 1\n    print(count)\n\n\nmain()\n";
const MEETING_ROOMS_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    events = []\n    idx = 1\n    for _ in range(n):\n        s = int(data[idx])\n        e = int(data[idx + 1])\n        idx += 2\n        events.append((s, 1))\n        events.append((e, -1))\n    events.sort()\n    current = 0\n    best = 0\n    for _, delta in events:\n        current += delta\n        if current > best:\n            best = current\n    print(best)\n\n\nmain()\n";
const MEETING_ROOMS_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    events = []\n    idx = 1\n    for _ in range(n):\n        s = int(data[idx])\n        e = int(data[idx + 1])\n        idx += 2\n        events.append((s, 0, 1))\n        events.append((e, 1, -1))\n    events.sort()\n    current = 0\n    best = 0\n    for _, _, delta in events:\n        current += delta\n        if current > best:\n            best = current\n    print(best)\n\n\nmain()\n";
const DIJKSTRA_SHORTEST_PATH_CORRECT =
  'import sys\nimport heapq\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    idx = 0\n    n = int(data[idx]); idx += 1\n    m = int(data[idx]); idx += 1\n    adj = [[] for _ in range(n + 1)]\n    for _ in range(m):\n        u = int(data[idx]); v = int(data[idx + 1]); w = int(data[idx + 2]); idx += 3\n        adj[u].append((v, w))\n        adj[v].append((u, w))\n    INF = float("inf")\n    dist = [INF] * (n + 1)\n    dist[1] = 0\n    pq = [(0, 1)]\n    while pq:\n        d, u = heapq.heappop(pq)\n        if d > dist[u]:\n            continue\n        if u == n:\n            break\n        for v, w in adj[u]:\n            nd = d + w\n            if nd < dist[v]:\n                dist[v] = nd\n                heapq.heappush(pq, (nd, v))\n    print(dist[n] if dist[n] < INF else -1)\n\n\nmain()\n';
const DIJKSTRA_SHORTEST_PATH_WRONG =
  "import sys\nimport heapq\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    idx = 0\n    n = int(data[idx]); idx += 1\n    m = int(data[idx]); idx += 1\n    adj = [[] for _ in range(n + 1)]\n    for _ in range(m):\n        u = int(data[idx]); v = int(data[idx + 1]); w = int(data[idx + 2]); idx += 3\n        adj[u].append((v, w))\n        adj[v].append((u, w))\n    visited = [False] * (n + 1)\n    visited[1] = True\n    pq = [(0, 1)]\n    while pq:\n        d, u = heapq.heappop(pq)\n        if u == n:\n            print(d)\n            return\n        for v, w in adj[u]:\n            if not visited[v]:\n                visited[v] = True\n                heapq.heappush(pq, (d + w, v))\n    print(-1)\n\n\nmain()\n";
const UNION_FIND_COMPONENTS_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    idx = 0\n    n = int(data[idx]); idx += 1\n    q = int(data[idx]); idx += 1\n    parent = list(range(n + 1))\n    size = [1] * (n + 1)\n\n    def find(x):\n        while parent[x] != x:\n            parent[x] = parent[parent[x]]\n            x = parent[x]\n        return x\n\n    out = []\n    for _ in range(q):\n        op = data[idx]; u = int(data[idx + 1]); v = int(data[idx + 2]); idx += 3\n        ru, rv = find(u), find(v)\n        if op == b"C":\n            if ru != rv:\n                if size[ru] < size[rv]:\n                    ru, rv = rv, ru\n                parent[rv] = ru\n                size[ru] += size[rv]\n        else:\n            out.append("YES" if ru == rv else "NO")\n    if out:\n        sys.stdout.write("\\n".join(out) + "\\n")\n\n\nmain()\n';
const UNION_FIND_COMPONENTS_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    idx = 0\n    n = int(data[idx]); idx += 1\n    q = int(data[idx]); idx += 1\n    edges = set()\n    out = []\n    for _ in range(q):\n        op = data[idx]; u = int(data[idx + 1]); v = int(data[idx + 2]); idx += 3\n        key = (min(u, v), max(u, v))\n        if op == "C":\n            edges.add(key)\n        else:\n            out.append("YES" if key in edges else "NO")\n    if out:\n        sys.stdout.write("\\n".join(out) + "\\n")\n\n\nmain()\n';
const KRUSKAL_MST_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    idx = 0\n    n = int(data[idx]); idx += 1\n    m = int(data[idx]); idx += 1\n    edges = []\n    for _ in range(m):\n        u = int(data[idx]); v = int(data[idx + 1]); w = int(data[idx + 2]); idx += 3\n        if u != v:\n            edges.append((w, u, v))\n    edges.sort()\n    parent = list(range(n + 1))\n\n    def find(x):\n        while parent[x] != x:\n            parent[x] = parent[parent[x]]\n            x = parent[x]\n        return x\n\n    total = 0\n    used = 0\n    for w, u, v in edges:\n        ru, rv = find(u), find(v)\n        if ru != rv:\n            parent[rv] = ru\n            total += w\n            used += 1\n    if used == n - 1:\n        print(total)\n    else:\n        print("IMPOSSIBLE")\n\n\nmain()\n';
const KRUSKAL_MST_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0]); m = int(data[1])\n    ws = []\n    idx = 2\n    for _ in range(m):\n        ws.append(int(data[idx + 2]))\n        idx += 3\n    if m < n - 1:\n        print("IMPOSSIBLE")\n        return\n    ws.sort()\n    print(sum(ws[: n - 1]))\n\n\nmain()\n';
const BIPARTITE_CHECK_CORRECT =
  'import sys\nfrom collections import deque\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    idx = 0\n    n = int(data[idx]); idx += 1\n    m = int(data[idx]); idx += 1\n    adj = [[] for _ in range(n + 1)]\n    for _ in range(m):\n        u = int(data[idx]); v = int(data[idx + 1]); idx += 2\n        adj[u].append(v)\n        adj[v].append(u)\n    color = [-1] * (n + 1)\n    for s in range(1, n + 1):\n        if color[s] != -1:\n            continue\n        color[s] = 0\n        dq = deque([s])\n        while dq:\n            u = dq.popleft()\n            for v in adj[u]:\n                if color[v] == -1:\n                    color[v] = color[u] ^ 1\n                    dq.append(v)\n                elif color[v] == color[u]:\n                    print("NO")\n                    return\n    print("YES")\n\n\nmain()\n';
const BIPARTITE_CHECK_WRONG =
  'import sys\nfrom collections import deque\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    idx = 0\n    n = int(data[idx]); idx += 1\n    m = int(data[idx]); idx += 1\n    adj = [[] for _ in range(n + 1)]\n    for _ in range(m):\n        u = int(data[idx]); v = int(data[idx + 1]); idx += 2\n        adj[u].append(v)\n        adj[v].append(u)\n    color = [-1] * (n + 1)\n    color[1] = 0\n    dq = deque([1])\n    while dq:\n        u = dq.popleft()\n        for v in adj[u]:\n            if color[v] == -1:\n                color[v] = color[u] ^ 1\n                dq.append(v)\n            elif color[v] == color[u]:\n                print("NO")\n                return\n    print("YES")\n\n\nmain()\n';
const COUNT_ISLANDS_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    r = int(data[0])\n    c = int(data[1])\n    grid = bytearray()\n    for i in range(r):\n        grid += data[2 + i]\n    n = r * c\n    land = 35\n    sea = 46\n    count = 0\n    for s in range(n):\n        if grid[s] == land:\n            count += 1\n            grid[s] = sea\n            stack = [s]\n            push = stack.append\n            pop = stack.pop\n            while stack:\n                p = pop()\n                q = p - c\n                if q >= 0 and grid[q] == land:\n                    grid[q] = sea\n                    push(q)\n                q = p + c\n                if q < n and grid[q] == land:\n                    grid[q] = sea\n                    push(q)\n                y = p % c\n                if y > 0 and grid[p - 1] == land:\n                    grid[p - 1] = sea\n                    push(p - 1)\n                if y + 1 < c and grid[p + 1] == land:\n                    grid[p + 1] = sea\n                    push(p + 1)\n    print(count)\n\n\nmain()\n";
const COUNT_ISLANDS_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    r = int(data[0])\n    c = int(data[1])\n    grid = [bytearray(data[2 + i]) for i in range(r)]\n    land = 35\n    sea = 46\n    count = 0\n    for si in range(r):\n        for sj in range(c):\n            if grid[si][sj] == land:\n                count += 1\n                grid[si][sj] = sea\n                stack = [(si, sj)]\n                while stack:\n                    x, y = stack.pop()\n                    for dx in (-1, 0, 1):\n                        for dy in (-1, 0, 1):\n                            nx, ny = x + dx, y + dy\n                            if 0 <= nx < r and 0 <= ny < c and grid[nx][ny] == land:\n                                grid[nx][ny] = sea\n                                stack.append((nx, ny))\n    print(count)\n\n\nmain()\n";
const TREE_DIAMETER_CORRECT =
  "import sys\nfrom collections import deque\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    adj = [[] for _ in range(n + 1)]\n    idx = 1\n    for _ in range(n - 1):\n        u = int(data[idx])\n        v = int(data[idx + 1])\n        idx += 2\n        adj[u].append(v)\n        adj[v].append(u)\n\n    def bfs(start):\n        dist = [-1] * (n + 1)\n        dist[start] = 0\n        q = deque([start])\n        far = start\n        while q:\n            u = q.popleft()\n            if dist[u] > dist[far]:\n                far = u\n            for v in adj[u]:\n                if dist[v] < 0:\n                    dist[v] = dist[u] + 1\n                    q.append(v)\n        return far, dist[far]\n\n    a, _ = bfs(1)\n    _, d = bfs(a)\n    print(d)\n\n\nmain()\n";
const TREE_DIAMETER_WRONG =
  "import sys\nfrom collections import deque\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    adj = [[] for _ in range(n + 1)]\n    idx = 1\n    for _ in range(n - 1):\n        u = int(data[idx])\n        v = int(data[idx + 1])\n        idx += 2\n        adj[u].append(v)\n        adj[v].append(u)\n    dist = [-1] * (n + 1)\n    dist[1] = 0\n    q = deque([1])\n    while q:\n        u = q.popleft()\n        for v in adj[u]:\n            if dist[v] < 0:\n                dist[v] = dist[u] + 1\n                q.append(v)\n    print(max(dist[1:]))\n\n\nmain()\n";
const COURSE_ORDER_CORRECT =
  'import sys\nfrom collections import deque\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    m = int(data[1])\n    adj = [[] for _ in range(n + 1)]\n    indeg = [0] * (n + 1)\n    idx = 2\n    for _ in range(m):\n        a = int(data[idx])\n        b = int(data[idx + 1])\n        idx += 2\n        adj[a].append(b)\n        indeg[b] += 1\n    q = deque(i for i in range(1, n + 1) if indeg[i] == 0)\n    order = []\n    while q:\n        u = q.popleft()\n        order.append(u)\n        for v in adj[u]:\n            indeg[v] -= 1\n            if indeg[v] == 0:\n                q.append(v)\n    if len(order) < n:\n        print(-1)\n    else:\n        sys.stdout.write(" ".join(map(str, order)) + "\\n")\n\n\nmain()\n';
const COURSE_ORDER_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    print(" ".join(str(i) for i in range(1, n + 1)))\n\n\nmain()\n';
const SHORTEST_ROUTE_PLAN_CORRECT =
  'import sys\nfrom collections import deque\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    m = int(data[1])\n    adj = [[] for _ in range(n + 1)]\n    idx = 2\n    for _ in range(m):\n        u = int(data[idx])\n        v = int(data[idx + 1])\n        idx += 2\n        adj[u].append(v)\n        adj[v].append(u)\n    parent = [0] * (n + 1)\n    dist = [-1] * (n + 1)\n    dist[1] = 0\n    q = deque([1])\n    while q:\n        u = q.popleft()\n        if u == n:\n            break\n        for v in adj[u]:\n            if dist[v] < 0:\n                dist[v] = dist[u] + 1\n                parent[v] = u\n                q.append(v)\n    if dist[n] < 0:\n        print(-1)\n        return\n    path = [n]\n    while path[-1] != 1:\n        path.append(parent[path[-1]])\n    path.reverse()\n    print(len(path))\n    print(" ".join(map(str, path)))\n\n\nmain()\n';
const SHORTEST_ROUTE_PLAN_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    m = int(data[1])\n    adj = [[] for _ in range(n + 1)]\n    idx = 2\n    for _ in range(m):\n        u = int(data[idx])\n        v = int(data[idx + 1])\n        idx += 2\n        adj[u].append(v)\n        adj[v].append(u)\n    if n == 1:\n        print(1)\n        print(1)\n        return\n    visited = [False] * (n + 1)\n    visited[1] = True\n    parent = [0] * (n + 1)\n    stack = [(1, iter(adj[1]))]\n    found = False\n    while stack and not found:\n        u, it = stack[-1]\n        advanced = False\n        for v in it:\n            if not visited[v]:\n                visited[v] = True\n                parent[v] = u\n                if v == n:\n                    found = True\n                else:\n                    stack.append((v, iter(adj[v])))\n                advanced = True\n                break\n        if not advanced:\n            stack.pop()\n    if not found:\n        print(-1)\n        return\n    path = [n]\n    while path[-1] != 1:\n        path.append(parent[path[-1]])\n    path.reverse()\n    print(len(path))\n    print(" ".join(map(str, path)))\n\n\nmain()\n';
const LONGEST_INCREASING_SUBSEQUENCE_CORRECT =
  "import sys\nfrom bisect import bisect_left\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    a = [int(x) for x in data[1 : 1 + n]]\n    tails = []\n    for x in a:\n        i = bisect_left(tails, x)\n        if i == len(tails):\n            tails.append(x)\n        else:\n            tails[i] = x\n    print(len(tails))\n\n\nmain()\n";
const LONGEST_INCREASING_SUBSEQUENCE_WRONG =
  "import sys\nfrom bisect import bisect_right\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    a = [int(x) for x in data[1 : 1 + n]]\n    tails = []\n    for x in a:\n        i = bisect_right(tails, x)\n        if i == len(tails):\n            tails.append(x)\n        else:\n            tails[i] = x\n    print(len(tails))\n\n\nmain()\n";
const EDIT_DISTANCE_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    s = data[0]\n    t = data[1]\n    m = len(t)\n    prev = list(range(m + 1))\n    for i, cs in enumerate(s, 1):\n        cur = [0] * (m + 1)\n        cur[0] = i\n        pj1 = prev[0]\n        cj = i\n        for j, ct in enumerate(t, 1):\n            pj = prev[j]\n            v = pj1 if cs == ct else pj1 + 1\n            w = pj + 1\n            if w < v:\n                v = w\n            w = cj + 1\n            if w < v:\n                v = w\n            cur[j] = v\n            cj = v\n            pj1 = pj\n        prev = cur\n    print(prev[m])\n\n\nmain()\n";
const EDIT_DISTANCE_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    s = data[0]\n    t = data[1]\n    m = len(t)\n    prev = [0] * (m + 1)\n    for cs in s:\n        cur = [0] * (m + 1)\n        c = 0\n        pj1 = 0\n        for j, ct in enumerate(t, 1):\n            pj = prev[j]\n            if cs == ct:\n                v = pj1 + 1\n            else:\n                v = pj if pj > c else c\n            cur[j] = v\n            c = v\n            pj1 = pj\n        prev = cur\n    print(len(s) + len(t) - 2 * prev[m])\n\n\nmain()\n";
const COIN_CHANGE_MIN_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    a = int(data[1])\n    coins = sorted({int(x) for x in data[2 : 2 + n]})\n    inf = float("inf")\n    dp = [0] + [inf] * a\n    for c in coins:\n        if c > a:\n            break\n        for x in range(c, a + 1):\n            v = dp[x - c] + 1\n            if v < dp[x]:\n                dp[x] = v\n    print(dp[a] if dp[a] != inf else -1)\n\n\nmain()\n';
const COIN_CHANGE_MIN_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    a = int(data[1])\n    coins = sorted({int(x) for x in data[2 : 2 + n]}, reverse=True)\n    count = 0\n    rem = a\n    for c in coins:\n        if c <= rem:\n            count += rem // c\n            rem %= c\n    print(count if rem == 0 else -1)\n\n\nmain()\n";
const LONGEST_COMMON_SUBSEQUENCE_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    s = data[0]\n    t = data[1]\n    m = len(t)\n    prev = [0] * (m + 1)\n    for cs in s:\n        cur = [0] * (m + 1)\n        c = 0\n        pj1 = 0\n        for j, ct in enumerate(t, 1):\n            pj = prev[j]\n            if cs == ct:\n                v = pj1 + 1\n            else:\n                v = pj if pj > c else c\n            cur[j] = v\n            c = v\n            pj1 = pj\n        prev = cur\n    print(prev[m])\n\n\nmain()\n";
const LONGEST_COMMON_SUBSEQUENCE_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    s = data[0]\n    t = data[1]\n    m = len(t)\n    prev = [0] * (m + 1)\n    best = 0\n    for cs in s:\n        cur = [0] * (m + 1)\n        for j, ct in enumerate(t, 1):\n            if cs == ct:\n                v = prev[j - 1] + 1\n                cur[j] = v\n                if v > best:\n                    best = v\n        prev = cur\n    print(best)\n\n\nmain()\n";
const GRID_PATHS_OBSTACLES_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    r_cnt = int(data[0])\n    c_cnt = int(data[1])\n    grid = [data[2 + i].decode() for i in range(r_cnt)]\n    mod = 10**9 + 7\n    dp = [0] * c_cnt\n    dp[0] = 1 if grid[0][0] == "." else 0\n    for r in range(r_cnt):\n        row = grid[r]\n        if row[0] == "#":\n            dp[0] = 0\n        for c in range(1, c_cnt):\n            if row[c] == "#":\n                dp[c] = 0\n            else:\n                dp[c] = (dp[c] + dp[c - 1]) % mod\n    print(dp[c_cnt - 1])\n\n\nmain()\n';
const GRID_PATHS_OBSTACLES_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    r_cnt = int(data[0])\n    c_cnt = int(data[1])\n    grid = [data[2 + i].decode() for i in range(r_cnt)]\n    dp = [0] * c_cnt\n    dp[0] = 1 if grid[0][0] == "." else 0\n    for r in range(r_cnt):\n        row = grid[r]\n        if row[0] == "#":\n            dp[0] = 0\n        for c in range(1, c_cnt):\n            if row[c] == "#":\n                dp[c] = 0\n            else:\n                dp[c] = dp[c] + dp[c - 1]\n    print(dp[c_cnt - 1])\n\n\nmain()\n';
const PARTITION_EQUAL_SUBSET_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    a = [int(x) for x in data[1 : 1 + n]]\n    total = sum(a)\n    if total % 2 == 1:\n        print("NO")\n        return\n    target = total // 2\n    bits = 1\n    for x in a:\n        bits |= bits << x\n    print("YES" if (bits >> target) & 1 else "NO")\n\n\nmain()\n';
const PARTITION_EQUAL_SUBSET_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    a = [int(x) for x in data[1 : 1 + n]]\n    print("YES" if sum(a) % 2 == 0 else "NO")\n\n\nmain()\n';
const TSP_BITMASK_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    d = [[int(data[1 + i * n + j]) for j in range(n)] for i in range(n)]\n    full = 1 << n\n    inf = float("inf")\n    dp = [[inf] * n for _ in range(full)]\n    dp[1][0] = 0\n    for mask in range(1, full, 2):\n        row = dp[mask]\n        for last in range(n):\n            cur = row[last]\n            if cur == inf:\n                continue\n            dl = d[last]\n            free = ~mask & (full - 1)\n            while free:\n                nb = free & -free\n                nxt = nb.bit_length() - 1\n                free ^= nb\n                v = cur + dl[nxt]\n                cell = dp[mask | nb]\n                if v < cell[nxt]:\n                    cell[nxt] = v\n    last_row = dp[full - 1]\n    print(min(last_row[i] + d[i][0] for i in range(1, n)))\n\n\nmain()\n';
const TSP_BITMASK_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    d = [[int(data[1 + i * n + j]) for j in range(n)] for i in range(n)]\n    visited = [False] * n\n    visited[0] = True\n    cur = 0\n    total = 0\n    for _ in range(n - 1):\n        best = -1\n        for j in range(n):\n            if not visited[j] and (best == -1 or d[cur][j] < d[cur][best]):\n                best = j\n        total += d[cur][best]\n        visited[best] = True\n        cur = best\n    total += d[cur][0]\n    print(total)\n\n\nmain()\n";
const LONGEST_PALINDROMIC_SUBSTRING_CORRECT =
  'import sys\n\n\ndef main():\n    s = sys.stdin.readline().strip()\n    t = "#" + "#".join(s) + "#"\n    n = len(t)\n    p = [0] * n\n    center = 0\n    right = 0\n    best = 0\n    for i in range(n):\n        if i < right:\n            p[i] = min(right - i, p[2 * center - i])\n        while i - p[i] - 1 >= 0 and i + p[i] + 1 < n and t[i - p[i] - 1] == t[i + p[i] + 1]:\n            p[i] += 1\n        if i + p[i] > right:\n            center = i\n            right = i + p[i]\n        if p[i] > best:\n            best = p[i]\n    print(best)\n\n\nmain()\n';
const LONGEST_PALINDROMIC_SUBSTRING_WRONG =
  "import sys\n\n\ndef main():\n    s = sys.stdin.readline().strip()\n    n = len(s)\n    dp = [[0] * n for _ in range(n)]\n    for i in range(n):\n        dp[i][i] = 1\n    for length in range(2, n + 1):\n        for i in range(n - length + 1):\n            j = i + length - 1\n            if s[i] == s[j]:\n                dp[i][j] = dp[i + 1][j - 1] + 2 if length > 2 else 2\n            else:\n                left = dp[i + 1][j]\n                right = dp[i][j - 1]\n                dp[i][j] = left if left > right else right\n    print(dp[0][n - 1])\n\n\nmain()\n";
const SLIDING_WINDOW_MAX_CORRECT =
  'import sys\nfrom collections import deque\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    k = int(data[1])\n    a = [int(x) for x in data[2:2 + n]]\n    dq = deque()\n    out = []\n    for i, v in enumerate(a):\n        while dq and a[dq[-1]] <= v:\n            dq.pop()\n        dq.append(i)\n        if dq[0] <= i - k:\n            dq.popleft()\n        if i >= k - 1:\n            out.append(a[dq[0]])\n    sys.stdout.write(" ".join(map(str, out)) + "\\n")\n\n\nmain()\n';
const SLIDING_WINDOW_MAX_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    k = int(data[1])\n    a = [int(x) for x in data[2:2 + n]]\n    out = [min(a[i:i + k]) for i in range(n - k + 1)]\n    sys.stdout.write(" ".join(map(str, out)) + "\\n")\n\n\nmain()\n';
const RANGE_SUM_QUERIES_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    q = int(data[1])\n    pre = [0] * (n + 1)\n    for i in range(n):\n        pre[i + 1] = pre[i] + int(data[2 + i])\n    pos = 2 + n\n    out = []\n    for _ in range(q):\n        l = int(data[pos])\n        r = int(data[pos + 1])\n        pos += 2\n        out.append(pre[r] - pre[l - 1])\n    sys.stdout.write("\\n".join(map(str, out)) + "\\n")\n\n\nmain()\n';
const RANGE_SUM_QUERIES_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    q = int(data[1])\n    a = [int(x) for x in data[2:2 + n]]\n    pos = 2 + n\n    res = []\n    for _ in range(q):\n        l = int(data[pos])\n        r = int(data[pos + 1])\n        pos += 2\n        res.append(sum(a[l - 1:r - 1]))\n    print("\\n".join(map(str, res)))\n\n\nmain()\n';
const DYNAMIC_RANGE_SUM_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    q = int(data[1])\n    a = [0] * (n + 1)\n    tree = [0] * (n + 1)\n    for i in range(1, n + 1):\n        a[i] = int(data[1 + i])\n        tree[i] += a[i]\n        j = i + (i & -i)\n        if j <= n:\n            tree[j] += tree[i]\n    idx = 2 + n\n    out = []\n    for _ in range(q):\n        op = data[idx]\n        x = int(data[idx + 1])\n        y = int(data[idx + 2])\n        idx += 3\n        if op == b"U":\n            d = y - a[x]\n            a[x] = y\n            i = x\n            while i <= n:\n                tree[i] += d\n                i += i & (-i)\n        else:\n            s = 0\n            i = y\n            while i > 0:\n                s += tree[i]\n                i -= i & (-i)\n            i = x - 1\n            while i > 0:\n                s -= tree[i]\n                i -= i & (-i)\n            out.append(s)\n    sys.stdout.write("\\n".join(map(str, out)) + ("\\n" if out else ""))\n\n\nmain()\n';
const DYNAMIC_RANGE_SUM_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    idx = 0\n    n = int(data[idx])\n    idx += 1\n    q = int(data[idx])\n    idx += 1\n    a = [int(data[idx + i]) for i in range(n)]\n    idx += n\n    out = []\n    for _ in range(q):\n        op = data[idx]\n        idx += 1\n        x = int(data[idx])\n        y = int(data[idx + 1])\n        idx += 2\n        if op == "U":\n            a[x - 1] += y\n        else:\n            out.append(sum(a[x - 1:y]))\n    print("\\n".join(map(str, out)))\n\n\nmain()\n';
const LARGEST_RECTANGLE_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    h = [int(x) for x in data[1:1 + n]]\n    stack = []\n    best = 0\n    for i in range(n + 1):\n        cur = h[i] if i < n else -1\n        while stack and h[stack[-1]] >= cur:\n            top = stack.pop()\n            height = h[top]\n            left = stack[-1] + 1 if stack else 0\n            area = height * (i - left)\n            if area > best:\n                best = area\n        stack.append(i)\n    print(best)\n\n\nmain()\n";
const LARGEST_RECTANGLE_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    h = [int(x) for x in data[1:1 + n]]\n    print(max(max(h), min(h) * n))\n\n\nmain()\n";
const COUNT_INVERSIONS_CORRECT =
  "import sys\n\n\ndef sort_count(a):\n    n = len(a)\n    if n <= 1:\n        return a, 0\n    m = n // 2\n    left, inv_l = sort_count(a[:m])\n    right, inv_r = sort_count(a[m:])\n    merged = []\n    inv = inv_l + inv_r\n    i = j = 0\n    nl, nr = len(left), len(right)\n    while i < nl and j < nr:\n        if left[i] <= right[j]:\n            merged.append(left[i])\n            i += 1\n        else:\n            inv += nl - i\n            merged.append(right[j])\n            j += 1\n    merged.extend(left[i:])\n    merged.extend(right[j:])\n    return merged, inv\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    a = [int(x) for x in data[1:1 + n]]\n    _, inv = sort_count(a)\n    print(inv)\n\n\nmain()\n";
const COUNT_INVERSIONS_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    a = [int(x) for x in data[1:1 + n]]\n    count = 0\n    for i in range(n):\n        ai = a[i]\n        for j in range(i + 1, n):\n            if ai >= a[j]:\n                count += 1\n    print(count)\n\n\nmain()\n";
const PATTERN_OCCURRENCES_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    t, p = data[0], data[1]\n    m = len(p)\n    fail = [0] * m\n    k = 0\n    for i in range(1, m):\n        while k > 0 and p[i] != p[k]:\n            k = fail[k - 1]\n        if p[i] == p[k]:\n            k += 1\n        fail[i] = k\n    count = 0\n    k = 0\n    for c in t:\n        while k > 0 and c != p[k]:\n            k = fail[k - 1]\n        if c == p[k]:\n            k += 1\n        if k == m:\n            count += 1\n            k = fail[k - 1]\n    print(count)\n\n\nmain()\n";
const PATTERN_OCCURRENCES_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    t, p = data[0], data[1]\n    print(t.count(p))\n\n\nmain()\n";
const LONGEST_UNIQUE_SUBSTRING_CORRECT =
  "import sys\n\n\ndef main():\n    s = sys.stdin.readline().strip()\n    last = {}\n    best = 0\n    start = 0\n    for i, c in enumerate(s):\n        prev = last.get(c, -1)\n        if prev >= start:\n            start = prev + 1\n        last[c] = i\n        length = i - start + 1\n        if length > best:\n            best = length\n    print(best)\n\n\nmain()\n";
const LONGEST_UNIQUE_SUBSTRING_WRONG =
  "import sys\n\n\ndef main():\n    s = sys.stdin.readline().strip()\n    best = 0\n    cur = set()\n    for c in s:\n        if c in cur:\n            cur = {c}\n        else:\n            cur.add(c)\n        if len(cur) > best:\n            best = len(cur)\n    print(best)\n\n\nmain()\n";
const PREFIX_COUNT_TRIE_CORRECT =
  "import sys\nfrom bisect import bisect_left\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    q = int(data[1])\n    words = sorted(data[2:2 + n])\n    out = []\n    for k in range(q):\n        p = data[2 + n + k]\n        lo = bisect_left(words, p)\n        hi = bisect_left(words, p + '{')\n        out.append(str(hi - lo))\n    print('\\n'.join(out))\n\n\nmain()\n";
const PREFIX_COUNT_TRIE_WRONG =
  "import sys\nfrom collections import Counter\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    q = int(data[1])\n    counts = Counter(data[2:2 + n])\n    out = []\n    for k in range(q):\n        p = data[2 + n + k]\n        out.append(str(counts[p]))\n    print('\\n'.join(out))\n\n\nmain()\n";
const COUNT_PRIMES_SIEVE_CORRECT =
  "import sys\n\n\ndef main():\n    n = int(sys.stdin.buffer.read().split()[0])\n    if n < 2:\n        print(0)\n        return\n    sieve = bytearray([1]) * (n + 1)\n    sieve[0] = 0\n    sieve[1] = 0\n    i = 2\n    while i * i <= n:\n        if sieve[i]:\n            sieve[i * i :: i] = bytearray(len(sieve[i * i :: i]))\n        i += 1\n    print(sum(sieve))\n\n\nmain()\n";
const COUNT_PRIMES_SIEVE_WRONG =
  "import sys\n\n\ndef main():\n    n = int(sys.stdin.buffer.read().split()[0])\n    sieve = bytearray([1]) * (n + 1)\n    sieve[0] = 0\n    i = 2\n    while i * i <= n:\n        if sieve[i]:\n            sieve[i * i :: i] = bytearray(len(sieve[i * i :: i]))\n        i += 1\n    print(sum(sieve))\n\n\nmain()\n";
const MODULAR_EXPONENTIATION_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    q = int(data[0])\n    out = []\n    idx = 1\n    for _ in range(q):\n        a, b, m = int(data[idx]), int(data[idx + 1]), int(data[idx + 2])\n        idx += 3\n        out.append(str(pow(a, b, m)))\n    sys.stdout.write("\\n".join(out) + "\\n")\n\n\nmain()\n';
const MODULAR_EXPONENTIATION_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    q = int(data[0])\n    out = []\n    idx = 1\n    for _ in range(q):\n        a, b, m = int(data[idx]), int(data[idx + 1]), int(data[idx + 2])\n        idx += 3\n        if m == 1:\n            out.append("0")\n        else:\n            out.append(str(pow(a, b % (m - 1), m)))\n    sys.stdout.write("\\n".join(out) + "\\n")\n\n\nmain()\n';
const BINOMIAL_MOD_CORRECT =
  'import sys\n\nMOD = 10**9 + 7\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    q = int(data[0])\n    queries = []\n    maxn = 0\n    idx = 1\n    for _ in range(q):\n        n, r = int(data[idx]), int(data[idx + 1])\n        idx += 2\n        queries.append((n, r))\n        if r <= n and n > maxn:\n            maxn = n\n    fact = [1] * (maxn + 1)\n    for i in range(1, maxn + 1):\n        fact[i] = fact[i - 1] * i % MOD\n    invf = [1] * (maxn + 1)\n    invf[maxn] = pow(fact[maxn], MOD - 2, MOD)\n    for i in range(maxn, 0, -1):\n        invf[i - 1] = invf[i] * i % MOD\n    out = []\n    for n, r in queries:\n        if r > n:\n            out.append("0")\n        else:\n            out.append(str(fact[n] * invf[r] % MOD * invf[n - r] % MOD))\n    sys.stdout.write("\\n".join(out) + "\\n")\n\n\nmain()\n';
const BINOMIAL_MOD_WRONG =
  'import sys\n\nMOD = 10**9 + 6\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    q = int(data[0])\n    queries = []\n    maxn = 0\n    idx = 1\n    for _ in range(q):\n        n, r = int(data[idx]), int(data[idx + 1])\n        idx += 2\n        queries.append((n, r))\n        if r <= n and n > maxn:\n            maxn = n\n    fact = [1] * (maxn + 1)\n    for i in range(1, maxn + 1):\n        fact[i] = fact[i - 1] * i % MOD\n    invf = [1] * (maxn + 1)\n    invf[maxn] = pow(fact[maxn], MOD - 2, MOD)\n    for i in range(maxn, 0, -1):\n        invf[i - 1] = invf[i] * i % MOD\n    out = []\n    for n, r in queries:\n        if r > n:\n            out.append("0")\n        else:\n            out.append(str(fact[n] * invf[r] % MOD * invf[n - r] % MOD))\n    sys.stdout.write("\\n".join(out) + "\\n")\n\n\nmain()\n';
const MATRIX_FIBONACCI_CORRECT =
  'import sys\n\nMOD = 10**9 + 7\n\n\ndef fib_pair(n):\n    if n == 0:\n        return (0, 1)\n    a, b = fib_pair(n >> 1)\n    c = a * ((2 * b - a) % MOD) % MOD\n    d = (a * a + b * b) % MOD\n    if n & 1:\n        return (d, (c + d) % MOD)\n    return (c, d)\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    q = int(data[0])\n    out = []\n    for i in range(1, q + 1):\n        out.append(str(fib_pair(int(data[i]))[0]))\n    sys.stdout.write("\\n".join(out) + "\\n")\n\n\nmain()\n';
const MATRIX_FIBONACCI_WRONG =
  'import sys\n\nMOD = 10**9 + 7\n\n\ndef fib_pair(n):\n    if n == 0:\n        return (0, 1)\n    a, b = fib_pair(n >> 1)\n    c = a * ((2 * b - a) % MOD) % MOD\n    d = (a * a + b * b) % MOD\n    if n & 1:\n        return (d, (c + d) % MOD)\n    return (c, d)\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    q = int(data[0])\n    out = []\n    for i in range(1, q + 1):\n        out.append(str(fib_pair(int(data[i]))[1]))\n    sys.stdout.write("\\n".join(out) + "\\n")\n\n\nmain()\n';
const POLYGON_AREA_CORRECT =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    xs = [0] * n\n    ys = [0] * n\n    for i in range(n):\n        xs[i] = int(data[1 + 2 * i])\n        ys[i] = int(data[2 + 2 * i])\n    s = 0\n    for i in range(n):\n        j = (i + 1) % n\n        s += xs[i] * ys[j] - xs[j] * ys[i]\n    print(abs(s))\n\n\nmain()\n";
const POLYGON_AREA_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    xs = [0] * n\n    ys = [0] * n\n    for i in range(n):\n        xs[i] = int(data[1 + 2 * i])\n        ys[i] = int(data[2 + 2 * i])\n    s = 0\n    for i in range(n):\n        j = (i + 1) % n\n        s += xs[i] * ys[j] - xs[j] * ys[i]\n    print(abs(s) // 2)\n\n\nmain()\n";
const CONVEX_HULL_AREA_CORRECT =
  "import sys\n\n\ndef cross(o, a, b):\n    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    pts = sorted({(int(data[1 + 2 * i]), int(data[2 + 2 * i])) for i in range(n)})\n    if len(pts) <= 2:\n        print(0)\n        return\n    lower = []\n    for p in pts:\n        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:\n            lower.pop()\n        lower.append(p)\n    upper = []\n    for p in reversed(pts):\n        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:\n            upper.pop()\n        upper.append(p)\n    hull = lower[:-1] + upper[:-1]\n    if len(hull) < 3:\n        print(0)\n        return\n    s = 0\n    m = len(hull)\n    for i in range(m):\n        x1, y1 = hull[i]\n        x2, y2 = hull[(i + 1) % m]\n        s += x1 * y2 - x2 * y1\n    print(abs(s))\n\n\nmain()\n";
const CONVEX_HULL_AREA_WRONG =
  "import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    xs = [0] * n\n    ys = [0] * n\n    for i in range(n):\n        xs[i] = int(data[1 + 2 * i])\n        ys[i] = int(data[2 + 2 * i])\n    s = 0\n    for i in range(n):\n        j = (i + 1) % n\n        s += xs[i] * ys[j] - xs[j] * ys[i]\n    print(abs(s))\n\n\nmain()\n";
const NIM_GAME_CORRECT =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    x = 0\n    for i in range(1, n + 1):\n        x ^= int(data[i])\n    print("First" if x else "Second")\n\n\nmain()\n';
const NIM_GAME_WRONG =
  'import sys\n\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n = int(data[0])\n    s = 0\n    for i in range(1, n + 1):\n        s += int(data[i])\n    print("First" if s % 2 else "Second")\n\n\nmain()\n';
const INTERACTIVE_PEAK_CORRECT =
  'import sys\n\n\ndef main():\n    n = int(sys.stdin.readline().split()[0])\n    cache = {}\n\n    def ask(i):\n        if i not in cache:\n            print(f"? {i}", flush=True)\n            cache[i] = int(sys.stdin.readline())\n        return cache[i]\n\n    lo, hi = 1, n\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if ask(mid) < ask(mid + 1):\n            lo = mid + 1\n        else:\n            hi = mid\n    print(f"! {lo}", flush=True)\n\n\nmain()\n';
const INTERACTIVE_PEAK_WRONG =
  'import sys\n\n\ndef main():\n    n = int(sys.stdin.readline().split()[0])\n    best_i = 1\n    best_v = None\n    for i in range(1, n + 1):\n        try:\n            print(f"? {i}", flush=True)\n        except BrokenPipeError:\n            return\n        line = sys.stdin.readline()\n        if not line:\n            return\n        v = int(line)\n        if best_v is None or v > best_v:\n            best_i, best_v = i, v\n    try:\n        print(f"! {best_i}", flush=True)\n    except BrokenPipeError:\n        pass\n\n\nmain()\n';

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
  "problem_interval-scheduling": {
    language: "python",
    correct: { sourceCode: INTERVAL_SCHEDULING_CORRECT },
    wrong: { sourceCode: INTERVAL_SCHEDULING_WRONG, expectVerdict: "WA" },
  },
  "problem_min-merge-cost": {
    language: "python",
    correct: { sourceCode: MIN_MERGE_COST_CORRECT },
    wrong: { sourceCode: MIN_MERGE_COST_WRONG, expectVerdict: "WA" },
  },
  "problem_pair-sum-count": {
    language: "python",
    correct: { sourceCode: PAIR_SUM_COUNT_CORRECT },
    wrong: { sourceCode: PAIR_SUM_COUNT_WRONG, expectVerdict: "WA" },
  },
  "problem_meeting-rooms": {
    language: "python",
    correct: { sourceCode: MEETING_ROOMS_CORRECT },
    wrong: { sourceCode: MEETING_ROOMS_WRONG, expectVerdict: "WA" },
  },
  "problem_dijkstra-shortest-path": {
    language: "python",
    correct: { sourceCode: DIJKSTRA_SHORTEST_PATH_CORRECT },
    wrong: { sourceCode: DIJKSTRA_SHORTEST_PATH_WRONG, expectVerdict: "WA" },
  },
  "problem_union-find-components": {
    language: "python",
    correct: { sourceCode: UNION_FIND_COMPONENTS_CORRECT },
    wrong: { sourceCode: UNION_FIND_COMPONENTS_WRONG, expectVerdict: "WA" },
  },
  "problem_kruskal-mst": {
    language: "python",
    correct: { sourceCode: KRUSKAL_MST_CORRECT },
    wrong: { sourceCode: KRUSKAL_MST_WRONG, expectVerdict: "WA" },
  },
  "problem_bipartite-check": {
    language: "python",
    correct: { sourceCode: BIPARTITE_CHECK_CORRECT },
    wrong: { sourceCode: BIPARTITE_CHECK_WRONG, expectVerdict: "WA" },
  },
  "problem_count-islands": {
    language: "python",
    correct: { sourceCode: COUNT_ISLANDS_CORRECT },
    wrong: { sourceCode: COUNT_ISLANDS_WRONG, expectVerdict: "WA" },
  },
  "problem_tree-diameter": {
    language: "python",
    correct: { sourceCode: TREE_DIAMETER_CORRECT },
    wrong: { sourceCode: TREE_DIAMETER_WRONG, expectVerdict: "WA" },
  },
  "problem_course-order": {
    language: "python",
    correct: { sourceCode: COURSE_ORDER_CORRECT },
    wrong: { sourceCode: COURSE_ORDER_WRONG, expectVerdict: "WA" },
  },
  "problem_shortest-route-plan": {
    language: "python",
    correct: { sourceCode: SHORTEST_ROUTE_PLAN_CORRECT },
    wrong: { sourceCode: SHORTEST_ROUTE_PLAN_WRONG, expectVerdict: "WA" },
  },
  "problem_longest-increasing-subsequence": {
    language: "python",
    correct: { sourceCode: LONGEST_INCREASING_SUBSEQUENCE_CORRECT },
    wrong: { sourceCode: LONGEST_INCREASING_SUBSEQUENCE_WRONG, expectVerdict: "WA" },
  },
  "problem_edit-distance": {
    language: "python",
    correct: { sourceCode: EDIT_DISTANCE_CORRECT },
    wrong: { sourceCode: EDIT_DISTANCE_WRONG, expectVerdict: "WA" },
  },
  "problem_coin-change-min": {
    language: "python",
    correct: { sourceCode: COIN_CHANGE_MIN_CORRECT },
    wrong: { sourceCode: COIN_CHANGE_MIN_WRONG, expectVerdict: "WA" },
  },
  "problem_longest-common-subsequence": {
    language: "python",
    correct: { sourceCode: LONGEST_COMMON_SUBSEQUENCE_CORRECT },
    wrong: { sourceCode: LONGEST_COMMON_SUBSEQUENCE_WRONG, expectVerdict: "WA" },
  },
  "problem_grid-paths-obstacles": {
    language: "python",
    correct: { sourceCode: GRID_PATHS_OBSTACLES_CORRECT },
    wrong: { sourceCode: GRID_PATHS_OBSTACLES_WRONG, expectVerdict: "WA" },
  },
  "problem_partition-equal-subset": {
    language: "python",
    correct: { sourceCode: PARTITION_EQUAL_SUBSET_CORRECT },
    wrong: { sourceCode: PARTITION_EQUAL_SUBSET_WRONG, expectVerdict: "WA" },
  },
  "problem_tsp-bitmask": {
    language: "python",
    correct: { sourceCode: TSP_BITMASK_CORRECT },
    wrong: { sourceCode: TSP_BITMASK_WRONG, expectVerdict: "WA" },
  },
  "problem_longest-palindromic-substring": {
    language: "python",
    correct: { sourceCode: LONGEST_PALINDROMIC_SUBSTRING_CORRECT },
    wrong: { sourceCode: LONGEST_PALINDROMIC_SUBSTRING_WRONG, expectVerdict: "WA" },
  },
  "problem_sliding-window-max": {
    language: "python",
    correct: { sourceCode: SLIDING_WINDOW_MAX_CORRECT },
    wrong: { sourceCode: SLIDING_WINDOW_MAX_WRONG, expectVerdict: "WA" },
  },
  "problem_range-sum-queries": {
    language: "python",
    correct: { sourceCode: RANGE_SUM_QUERIES_CORRECT },
    wrong: { sourceCode: RANGE_SUM_QUERIES_WRONG, expectVerdict: "WA" },
  },
  "problem_dynamic-range-sum": {
    language: "python",
    correct: { sourceCode: DYNAMIC_RANGE_SUM_CORRECT },
    wrong: { sourceCode: DYNAMIC_RANGE_SUM_WRONG, expectVerdict: "WA" },
  },
  "problem_largest-rectangle": {
    language: "python",
    correct: { sourceCode: LARGEST_RECTANGLE_CORRECT },
    wrong: { sourceCode: LARGEST_RECTANGLE_WRONG, expectVerdict: "WA" },
  },
  "problem_count-inversions": {
    language: "python",
    correct: { sourceCode: COUNT_INVERSIONS_CORRECT },
    wrong: { sourceCode: COUNT_INVERSIONS_WRONG, expectVerdict: "WA" },
  },
  "problem_pattern-occurrences": {
    language: "python",
    correct: { sourceCode: PATTERN_OCCURRENCES_CORRECT },
    wrong: { sourceCode: PATTERN_OCCURRENCES_WRONG, expectVerdict: "WA" },
  },
  "problem_longest-unique-substring": {
    language: "python",
    correct: { sourceCode: LONGEST_UNIQUE_SUBSTRING_CORRECT },
    wrong: { sourceCode: LONGEST_UNIQUE_SUBSTRING_WRONG, expectVerdict: "WA" },
  },
  "problem_prefix-count-trie": {
    language: "python",
    correct: { sourceCode: PREFIX_COUNT_TRIE_CORRECT },
    wrong: { sourceCode: PREFIX_COUNT_TRIE_WRONG, expectVerdict: "WA" },
  },
  "problem_count-primes-sieve": {
    language: "python",
    correct: { sourceCode: COUNT_PRIMES_SIEVE_CORRECT },
    wrong: { sourceCode: COUNT_PRIMES_SIEVE_WRONG, expectVerdict: "WA" },
  },
  "problem_modular-exponentiation": {
    language: "python",
    correct: { sourceCode: MODULAR_EXPONENTIATION_CORRECT },
    wrong: { sourceCode: MODULAR_EXPONENTIATION_WRONG, expectVerdict: "WA" },
  },
  "problem_binomial-mod": {
    language: "python",
    correct: { sourceCode: BINOMIAL_MOD_CORRECT },
    wrong: { sourceCode: BINOMIAL_MOD_WRONG, expectVerdict: "WA" },
  },
  "problem_matrix-fibonacci": {
    language: "python",
    correct: { sourceCode: MATRIX_FIBONACCI_CORRECT },
    wrong: { sourceCode: MATRIX_FIBONACCI_WRONG, expectVerdict: "WA" },
  },
  "problem_polygon-area": {
    language: "python",
    correct: { sourceCode: POLYGON_AREA_CORRECT },
    wrong: { sourceCode: POLYGON_AREA_WRONG, expectVerdict: "WA" },
  },
  "problem_convex-hull-area": {
    language: "python",
    correct: { sourceCode: CONVEX_HULL_AREA_CORRECT },
    wrong: { sourceCode: CONVEX_HULL_AREA_WRONG, expectVerdict: "WA" },
  },
  "problem_nim-game": {
    language: "python",
    correct: { sourceCode: NIM_GAME_CORRECT },
    wrong: { sourceCode: NIM_GAME_WRONG, expectVerdict: "WA" },
  },
  "problem_interactive-peak": {
    language: "python",
    correct: { sourceCode: INTERACTIVE_PEAK_CORRECT },
    wrong: { sourceCode: INTERACTIVE_PEAK_WRONG, expectVerdict: "WA" },
  },
};
