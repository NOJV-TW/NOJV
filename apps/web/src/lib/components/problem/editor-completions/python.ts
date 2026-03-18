import type { CompletionEntry } from "./index";

export const pythonCompletions: CompletionEntry[] = [
  // I/O
  {
    label: "input",
    kind: "Function",
    insertText: "input(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "print",
    kind: "Function",
    insertText: "print(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "sys.stdin.readline",
    kind: "Function",
    insertText: "sys.stdin.readline().strip()",
    detail: "fast input"
  },
  {
    label: "sys.setrecursionlimit",
    kind: "Function",
    insertText: "sys.setrecursionlimit(${1:10**6})",
    detail: "sys",
    isSnippet: true
  },
  // Imports
  { label: "import sys", kind: "Snippet", insertText: "import sys", detail: "module" },
  {
    label: "from collections import",
    kind: "Snippet",
    insertText: "from collections import ${1:defaultdict}",
    detail: "module",
    isSnippet: true
  },
  {
    label: "from itertools import",
    kind: "Snippet",
    insertText: "from itertools import ${1:permutations}",
    detail: "module",
    isSnippet: true
  },
  {
    label: "from heapq import",
    kind: "Snippet",
    insertText: "from heapq import heappush, heappop",
    detail: "module"
  },
  {
    label: "from bisect import",
    kind: "Snippet",
    insertText: "from bisect import bisect_left, bisect_right",
    detail: "module"
  },
  {
    label: "from functools import",
    kind: "Snippet",
    insertText: "from functools import lru_cache",
    detail: "module"
  },
  {
    label: "from math import",
    kind: "Snippet",
    insertText: "from math import ${1:gcd}",
    detail: "module",
    isSnippet: true
  },
  // Builtins
  {
    label: "len",
    kind: "Function",
    insertText: "len(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "range",
    kind: "Function",
    insertText: "range(${1:n})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "sorted",
    kind: "Function",
    insertText: "sorted(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "reversed",
    kind: "Function",
    insertText: "reversed(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "enumerate",
    kind: "Function",
    insertText: "enumerate(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "zip",
    kind: "Function",
    insertText: "zip(${1:a}, ${2:b})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "map",
    kind: "Function",
    insertText: "map(${1:int}, ${2:input().split()})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "filter",
    kind: "Function",
    insertText: "filter(${1:func}, ${2:iterable})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "sum",
    kind: "Function",
    insertText: "sum(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "min",
    kind: "Function",
    insertText: "min(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "max",
    kind: "Function",
    insertText: "max(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "abs",
    kind: "Function",
    insertText: "abs(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "pow",
    kind: "Function",
    insertText: "pow(${1:base}, ${2:exp})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "divmod",
    kind: "Function",
    insertText: "divmod(${1:a}, ${2:b})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "int",
    kind: "Function",
    insertText: "int(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "str",
    kind: "Function",
    insertText: "str(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "list",
    kind: "Function",
    insertText: "list(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "set",
    kind: "Function",
    insertText: "set(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "dict",
    kind: "Function",
    insertText: "dict(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "tuple",
    kind: "Function",
    insertText: "tuple(${1})",
    detail: "builtin",
    isSnippet: true
  },
  // collections
  {
    label: "defaultdict",
    kind: "Class",
    insertText: "defaultdict(${1:int})",
    detail: "collections",
    isSnippet: true
  },
  {
    label: "Counter",
    kind: "Class",
    insertText: "Counter(${1})",
    detail: "collections",
    isSnippet: true
  },
  {
    label: "deque",
    kind: "Class",
    insertText: "deque(${1})",
    detail: "collections",
    isSnippet: true
  },
  // heapq
  {
    label: "heappush",
    kind: "Function",
    insertText: "heappush(${1:heap}, ${2:val})",
    detail: "heapq",
    isSnippet: true
  },
  {
    label: "heappop",
    kind: "Function",
    insertText: "heappop(${1:heap})",
    detail: "heapq",
    isSnippet: true
  },
  {
    label: "heapify",
    kind: "Function",
    insertText: "heapify(${1:lst})",
    detail: "heapq",
    isSnippet: true
  },
  // bisect
  {
    label: "bisect_left",
    kind: "Function",
    insertText: "bisect_left(${1:arr}, ${2:val})",
    detail: "bisect",
    isSnippet: true
  },
  {
    label: "bisect_right",
    kind: "Function",
    insertText: "bisect_right(${1:arr}, ${2:val})",
    detail: "bisect",
    isSnippet: true
  },
  // math
  {
    label: "math.gcd",
    kind: "Function",
    insertText: "math.gcd(${1:a}, ${2:b})",
    detail: "math",
    isSnippet: true
  },
  {
    label: "math.lcm",
    kind: "Function",
    insertText: "math.lcm(${1:a}, ${2:b})",
    detail: "math (3.9+)",
    isSnippet: true
  },
  {
    label: "math.sqrt",
    kind: "Function",
    insertText: "math.sqrt(${1:x})",
    detail: "math",
    isSnippet: true
  },
  {
    label: "math.ceil",
    kind: "Function",
    insertText: "math.ceil(${1:x})",
    detail: "math",
    isSnippet: true
  },
  {
    label: "math.floor",
    kind: "Function",
    insertText: "math.floor(${1:x})",
    detail: "math",
    isSnippet: true
  },
  {
    label: "math.log",
    kind: "Function",
    insertText: "math.log(${1:x})",
    detail: "math",
    isSnippet: true
  },
  {
    label: "math.log2",
    kind: "Function",
    insertText: "math.log2(${1:x})",
    detail: "math",
    isSnippet: true
  },
  { label: "math.inf", kind: "Constant", insertText: "math.inf", detail: "math" },
  // functools
  {
    label: "lru_cache",
    kind: "Function",
    insertText: "lru_cache(maxsize=${1:None})",
    detail: "functools",
    isSnippet: true
  },
  // itertools
  {
    label: "permutations",
    kind: "Function",
    insertText: "permutations(${1:iterable})",
    detail: "itertools",
    isSnippet: true
  },
  {
    label: "combinations",
    kind: "Function",
    insertText: "combinations(${1:iterable}, ${2:r})",
    detail: "itertools",
    isSnippet: true
  },
  {
    label: "product",
    kind: "Function",
    insertText: "product(${1:a}, ${2:b})",
    detail: "itertools",
    isSnippet: true
  },
  // Patterns
  {
    label: "read ints",
    kind: "Snippet",
    insertText: "list(map(int, input().split()))",
    detail: "input pattern"
  },
  { label: "read n", kind: "Snippet", insertText: "n = int(input())", detail: "input pattern" },
  {
    label: "fast input",
    kind: "Snippet",
    insertText: "import sys\ninput = sys.stdin.readline",
    detail: "input pattern"
  }
];
