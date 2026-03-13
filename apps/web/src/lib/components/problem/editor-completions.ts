import type * as Monaco from "monaco-editor";

type CompletionEntry = {
  label: string;
  kind: "Function" | "Keyword" | "Snippet" | "Class" | "Module" | "Constant";
  insertText: string;
  detail?: string;
  isSnippet?: boolean;
};

const kindMap: Record<CompletionEntry["kind"], number> = {
  Class: 5,
  Constant: 21,
  Function: 1,
  Keyword: 17,
  Module: 8,
  Snippet: 27
};

// ─── C ───
const cCompletions: CompletionEntry[] = [
  {
    label: "printf",
    kind: "Function",
    insertText: 'printf("${1:%s}\\n", ${2:var});',
    detail: "stdio.h",
    isSnippet: true
  },
  {
    label: "scanf",
    kind: "Function",
    insertText: 'scanf("${1:%d}", &${2:var});',
    detail: "stdio.h",
    isSnippet: true
  },
  {
    label: "puts",
    kind: "Function",
    insertText: "puts(${1:str});",
    detail: "stdio.h",
    isSnippet: true
  },
  { label: "getchar", kind: "Function", insertText: "getchar()", detail: "stdio.h" },
  {
    label: "putchar",
    kind: "Function",
    insertText: "putchar(${1:c});",
    detail: "stdio.h",
    isSnippet: true
  },
  {
    label: "malloc",
    kind: "Function",
    insertText: "(${1:int} *)malloc(${2:n} * sizeof(${1:int}));",
    detail: "stdlib.h",
    isSnippet: true
  },
  {
    label: "calloc",
    kind: "Function",
    insertText: "(${1:int} *)calloc(${2:n}, sizeof(${1:int}));",
    detail: "stdlib.h",
    isSnippet: true
  },
  {
    label: "free",
    kind: "Function",
    insertText: "free(${1:ptr});",
    detail: "stdlib.h",
    isSnippet: true
  },
  {
    label: "memset",
    kind: "Function",
    insertText: "memset(${1:arr}, ${2:0}, sizeof(${1:arr}));",
    detail: "string.h",
    isSnippet: true
  },
  {
    label: "memcpy",
    kind: "Function",
    insertText: "memcpy(${1:dest}, ${2:src}, ${3:n});",
    detail: "string.h",
    isSnippet: true
  },
  {
    label: "strlen",
    kind: "Function",
    insertText: "strlen(${1:s})",
    detail: "string.h",
    isSnippet: true
  },
  {
    label: "strcmp",
    kind: "Function",
    insertText: "strcmp(${1:a}, ${2:b})",
    detail: "string.h",
    isSnippet: true
  },
  {
    label: "strcpy",
    kind: "Function",
    insertText: "strcpy(${1:dest}, ${2:src});",
    detail: "string.h",
    isSnippet: true
  },
  {
    label: "strcat",
    kind: "Function",
    insertText: "strcat(${1:dest}, ${2:src});",
    detail: "string.h",
    isSnippet: true
  },
  {
    label: "qsort",
    kind: "Function",
    insertText: "qsort(${1:arr}, ${2:n}, sizeof(${1:arr}[0]), ${3:cmp});",
    detail: "stdlib.h",
    isSnippet: true
  },
  {
    label: "abs",
    kind: "Function",
    insertText: "abs(${1:x})",
    detail: "stdlib.h",
    isSnippet: true
  },
  {
    label: "atoi",
    kind: "Function",
    insertText: "atoi(${1:s})",
    detail: "stdlib.h",
    isSnippet: true
  },
  {
    label: "#include <stdio.h>",
    kind: "Snippet",
    insertText: "#include <stdio.h>",
    detail: "header"
  },
  {
    label: "#include <stdlib.h>",
    kind: "Snippet",
    insertText: "#include <stdlib.h>",
    detail: "header"
  },
  {
    label: "#include <string.h>",
    kind: "Snippet",
    insertText: "#include <string.h>",
    detail: "header"
  },
  {
    label: "#include <math.h>",
    kind: "Snippet",
    insertText: "#include <math.h>",
    detail: "header"
  }
];

// ─── C++ ───
const cppCompletions: CompletionEntry[] = [
  // Headers & boilerplate
  {
    label: "#include <bits/stdc++.h>",
    kind: "Snippet",
    insertText: "#include <bits/stdc++.h>",
    detail: "all-in-one header"
  },
  {
    label: "#include <iostream>",
    kind: "Snippet",
    insertText: "#include <iostream>",
    detail: "header"
  },
  {
    label: "#include <vector>",
    kind: "Snippet",
    insertText: "#include <vector>",
    detail: "header"
  },
  {
    label: "#include <algorithm>",
    kind: "Snippet",
    insertText: "#include <algorithm>",
    detail: "header"
  },
  {
    label: "#include <string>",
    kind: "Snippet",
    insertText: "#include <string>",
    detail: "header"
  },
  { label: "#include <map>", kind: "Snippet", insertText: "#include <map>", detail: "header" },
  { label: "#include <set>", kind: "Snippet", insertText: "#include <set>", detail: "header" },
  {
    label: "#include <queue>",
    kind: "Snippet",
    insertText: "#include <queue>",
    detail: "header"
  },
  {
    label: "#include <stack>",
    kind: "Snippet",
    insertText: "#include <stack>",
    detail: "header"
  },
  {
    label: "#include <unordered_map>",
    kind: "Snippet",
    insertText: "#include <unordered_map>",
    detail: "header"
  },
  {
    label: "#include <unordered_set>",
    kind: "Snippet",
    insertText: "#include <unordered_set>",
    detail: "header"
  },
  {
    label: "#include <numeric>",
    kind: "Snippet",
    insertText: "#include <numeric>",
    detail: "header"
  },
  {
    label: "using namespace std;",
    kind: "Snippet",
    insertText: "using namespace std;",
    detail: "namespace"
  },
  // I/O
  {
    label: "cin",
    kind: "Keyword",
    insertText: "cin >> ${1:x};",
    detail: "iostream",
    isSnippet: true
  },
  {
    label: "cout",
    kind: "Keyword",
    insertText: 'cout << ${1:x} << "\\n";',
    detail: "iostream",
    isSnippet: true
  },
  {
    label: "getline",
    kind: "Function",
    insertText: "getline(cin, ${1:s});",
    detail: "string",
    isSnippet: true
  },
  {
    label: "ios::sync_with_stdio",
    kind: "Snippet",
    insertText: "ios::sync_with_stdio(false);\ncin.tie(nullptr);",
    detail: "fast I/O"
  },
  // Containers
  {
    label: "vector",
    kind: "Class",
    insertText: "vector<${1:int}> ${2:v};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "map",
    kind: "Class",
    insertText: "map<${1:int}, ${2:int}> ${3:mp};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "set",
    kind: "Class",
    insertText: "set<${1:int}> ${2:st};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "unordered_map",
    kind: "Class",
    insertText: "unordered_map<${1:int}, ${2:int}> ${3:mp};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "unordered_set",
    kind: "Class",
    insertText: "unordered_set<${1:int}> ${2:st};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "priority_queue",
    kind: "Class",
    insertText: "priority_queue<${1:int}> ${2:pq};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "priority_queue (min)",
    kind: "Class",
    insertText: "priority_queue<${1:int}, vector<${1:int}>, greater<${1:int}>> ${2:pq};",
    detail: "min-heap",
    isSnippet: true
  },
  {
    label: "queue",
    kind: "Class",
    insertText: "queue<${1:int}> ${2:q};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "stack",
    kind: "Class",
    insertText: "stack<${1:int}> ${2:st};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "deque",
    kind: "Class",
    insertText: "deque<${1:int}> ${2:dq};",
    detail: "STL container",
    isSnippet: true
  },
  {
    label: "pair",
    kind: "Class",
    insertText: "pair<${1:int}, ${2:int}>",
    detail: "STL utility",
    isSnippet: true
  },
  {
    label: "make_pair",
    kind: "Function",
    insertText: "make_pair(${1:a}, ${2:b})",
    detail: "STL utility",
    isSnippet: true
  },
  {
    label: "tuple",
    kind: "Class",
    insertText: "tuple<${1:int}, ${2:int}, ${3:int}>",
    detail: "STL utility",
    isSnippet: true
  },
  // Algorithms
  {
    label: "sort",
    kind: "Function",
    insertText: "sort(${1:v}.begin(), ${1:v}.end());",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "reverse",
    kind: "Function",
    insertText: "reverse(${1:v}.begin(), ${1:v}.end());",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "lower_bound",
    kind: "Function",
    insertText: "lower_bound(${1:v}.begin(), ${1:v}.end(), ${2:val})",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "upper_bound",
    kind: "Function",
    insertText: "upper_bound(${1:v}.begin(), ${1:v}.end(), ${2:val})",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "binary_search",
    kind: "Function",
    insertText: "binary_search(${1:v}.begin(), ${1:v}.end(), ${2:val})",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "next_permutation",
    kind: "Function",
    insertText: "next_permutation(${1:v}.begin(), ${1:v}.end())",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "max_element",
    kind: "Function",
    insertText: "max_element(${1:v}.begin(), ${1:v}.end())",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "min_element",
    kind: "Function",
    insertText: "min_element(${1:v}.begin(), ${1:v}.end())",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "accumulate",
    kind: "Function",
    insertText: "accumulate(${1:v}.begin(), ${1:v}.end(), ${2:0})",
    detail: "numeric",
    isSnippet: true
  },
  {
    label: "gcd",
    kind: "Function",
    insertText: "gcd(${1:a}, ${2:b})",
    detail: "numeric (C++17)",
    isSnippet: true
  },
  {
    label: "lcm",
    kind: "Function",
    insertText: "lcm(${1:a}, ${2:b})",
    detail: "numeric (C++17)",
    isSnippet: true
  },
  {
    label: "unique",
    kind: "Function",
    insertText: "unique(${1:v}.begin(), ${1:v}.end())",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "fill",
    kind: "Function",
    insertText: "fill(${1:v}.begin(), ${1:v}.end(), ${2:0});",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "count",
    kind: "Function",
    insertText: "count(${1:v}.begin(), ${1:v}.end(), ${2:val})",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "find",
    kind: "Function",
    insertText: "find(${1:v}.begin(), ${1:v}.end(), ${2:val})",
    detail: "algorithm",
    isSnippet: true
  },
  // Math & limits
  { label: "INT_MAX", kind: "Constant", insertText: "INT_MAX", detail: "climits" },
  { label: "INT_MIN", kind: "Constant", insertText: "INT_MIN", detail: "climits" },
  { label: "LLONG_MAX", kind: "Constant", insertText: "LLONG_MAX", detail: "climits" },
  { label: "LLONG_MIN", kind: "Constant", insertText: "LLONG_MIN", detail: "climits" },
  {
    label: "abs",
    kind: "Function",
    insertText: "abs(${1:x})",
    detail: "cstdlib",
    isSnippet: true
  },
  {
    label: "min",
    kind: "Function",
    insertText: "min(${1:a}, ${2:b})",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "max",
    kind: "Function",
    insertText: "max(${1:a}, ${2:b})",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "swap",
    kind: "Function",
    insertText: "swap(${1:a}, ${2:b});",
    detail: "algorithm",
    isSnippet: true
  },
  {
    label: "memset",
    kind: "Function",
    insertText: "memset(${1:arr}, ${2:0}, sizeof(${1:arr}));",
    detail: "cstring",
    isSnippet: true
  }
];

// ─── Python ───
const pythonCompletions: CompletionEntry[] = [
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

// ─── Java ───
const javaCompletions: CompletionEntry[] = [
  // I/O
  {
    label: "Scanner",
    kind: "Class",
    insertText: "Scanner ${1:sc} = new Scanner(System.in);",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "BufferedReader",
    kind: "Class",
    insertText:
      "BufferedReader ${1:br} = new BufferedReader(new InputStreamReader(System.in));",
    detail: "java.io",
    isSnippet: true
  },
  {
    label: "PrintWriter",
    kind: "Class",
    insertText: "PrintWriter ${1:out} = new PrintWriter(new BufferedOutputStream(System.out));",
    detail: "java.io",
    isSnippet: true
  },
  {
    label: "System.out.println",
    kind: "Function",
    insertText: "System.out.println(${1});",
    detail: "output",
    isSnippet: true
  },
  {
    label: "System.out.print",
    kind: "Function",
    insertText: "System.out.print(${1});",
    detail: "output",
    isSnippet: true
  },
  {
    label: "StringBuilder",
    kind: "Class",
    insertText: "StringBuilder ${1:sb} = new StringBuilder();",
    detail: "java.lang",
    isSnippet: true
  },
  // Imports
  {
    label: "import java.util.*",
    kind: "Snippet",
    insertText: "import java.util.*;",
    detail: "import"
  },
  {
    label: "import java.io.*",
    kind: "Snippet",
    insertText: "import java.io.*;",
    detail: "import"
  },
  // Collections
  {
    label: "ArrayList",
    kind: "Class",
    insertText: "ArrayList<${1:Integer}> ${2:list} = new ArrayList<>();",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "LinkedList",
    kind: "Class",
    insertText: "LinkedList<${1:Integer}> ${2:list} = new LinkedList<>();",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "HashMap",
    kind: "Class",
    insertText: "HashMap<${1:Integer}, ${2:Integer}> ${3:map} = new HashMap<>();",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "TreeMap",
    kind: "Class",
    insertText: "TreeMap<${1:Integer}, ${2:Integer}> ${3:map} = new TreeMap<>();",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "HashSet",
    kind: "Class",
    insertText: "HashSet<${1:Integer}> ${2:set} = new HashSet<>();",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "TreeSet",
    kind: "Class",
    insertText: "TreeSet<${1:Integer}> ${2:set} = new TreeSet<>();",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "PriorityQueue",
    kind: "Class",
    insertText: "PriorityQueue<${1:Integer}> ${2:pq} = new PriorityQueue<>();",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "PriorityQueue (reverse)",
    kind: "Class",
    insertText:
      "PriorityQueue<${1:Integer}> ${2:pq} = new PriorityQueue<>(Collections.reverseOrder());",
    detail: "max-heap",
    isSnippet: true
  },
  {
    label: "ArrayDeque",
    kind: "Class",
    insertText: "ArrayDeque<${1:Integer}> ${2:dq} = new ArrayDeque<>();",
    detail: "java.util",
    isSnippet: true
  },
  {
    label: "Stack",
    kind: "Class",
    insertText: "Stack<${1:Integer}> ${2:st} = new Stack<>();",
    detail: "java.util",
    isSnippet: true
  },
  // Arrays / Collections utilities
  {
    label: "Arrays.sort",
    kind: "Function",
    insertText: "Arrays.sort(${1:arr});",
    detail: "java.util.Arrays",
    isSnippet: true
  },
  {
    label: "Arrays.fill",
    kind: "Function",
    insertText: "Arrays.fill(${1:arr}, ${2:val});",
    detail: "java.util.Arrays",
    isSnippet: true
  },
  {
    label: "Arrays.binarySearch",
    kind: "Function",
    insertText: "Arrays.binarySearch(${1:arr}, ${2:key})",
    detail: "java.util.Arrays",
    isSnippet: true
  },
  {
    label: "Collections.sort",
    kind: "Function",
    insertText: "Collections.sort(${1:list});",
    detail: "java.util.Collections",
    isSnippet: true
  },
  {
    label: "Collections.reverse",
    kind: "Function",
    insertText: "Collections.reverse(${1:list});",
    detail: "java.util.Collections",
    isSnippet: true
  },
  // Math
  {
    label: "Math.min",
    kind: "Function",
    insertText: "Math.min(${1:a}, ${2:b})",
    detail: "java.lang.Math",
    isSnippet: true
  },
  {
    label: "Math.max",
    kind: "Function",
    insertText: "Math.max(${1:a}, ${2:b})",
    detail: "java.lang.Math",
    isSnippet: true
  },
  {
    label: "Math.abs",
    kind: "Function",
    insertText: "Math.abs(${1:x})",
    detail: "java.lang.Math",
    isSnippet: true
  },
  {
    label: "Math.pow",
    kind: "Function",
    insertText: "Math.pow(${1:base}, ${2:exp})",
    detail: "java.lang.Math",
    isSnippet: true
  },
  {
    label: "Math.sqrt",
    kind: "Function",
    insertText: "Math.sqrt(${1:x})",
    detail: "java.lang.Math",
    isSnippet: true
  },
  {
    label: "Integer.MAX_VALUE",
    kind: "Constant",
    insertText: "Integer.MAX_VALUE",
    detail: "java.lang"
  },
  {
    label: "Integer.MIN_VALUE",
    kind: "Constant",
    insertText: "Integer.MIN_VALUE",
    detail: "java.lang"
  },
  {
    label: "Long.MAX_VALUE",
    kind: "Constant",
    insertText: "Long.MAX_VALUE",
    detail: "java.lang"
  },
  // String
  {
    label: "Integer.parseInt",
    kind: "Function",
    insertText: "Integer.parseInt(${1:s})",
    detail: "java.lang",
    isSnippet: true
  },
  {
    label: "String.valueOf",
    kind: "Function",
    insertText: "String.valueOf(${1:x})",
    detail: "java.lang",
    isSnippet: true
  }
];

// ─── Go ───
const goCompletions: CompletionEntry[] = [
  {
    label: "fmt.Println",
    kind: "Function",
    insertText: "fmt.Println(${1})",
    detail: "fmt",
    isSnippet: true
  },
  {
    label: "fmt.Printf",
    kind: "Function",
    insertText: 'fmt.Printf("${1:%d}\\n", ${2:x})',
    detail: "fmt",
    isSnippet: true
  },
  {
    label: "fmt.Scanf",
    kind: "Function",
    insertText: 'fmt.Scanf("${1:%d}", &${2:x})',
    detail: "fmt",
    isSnippet: true
  },
  {
    label: "fmt.Sscanf",
    kind: "Function",
    insertText: 'fmt.Sscanf(${1:s}, "${2:%d}", &${3:x})',
    detail: "fmt",
    isSnippet: true
  },
  {
    label: "fmt.Scan",
    kind: "Function",
    insertText: "fmt.Scan(&${1:x})",
    detail: "fmt",
    isSnippet: true
  },
  {
    label: "bufio.NewReader",
    kind: "Function",
    insertText: "bufio.NewReader(os.Stdin)",
    detail: "bufio"
  },
  {
    label: "bufio.NewScanner",
    kind: "Function",
    insertText: "bufio.NewScanner(os.Stdin)",
    detail: "bufio"
  },
  {
    label: "sort.Ints",
    kind: "Function",
    insertText: "sort.Ints(${1:arr})",
    detail: "sort",
    isSnippet: true
  },
  {
    label: "sort.Strings",
    kind: "Function",
    insertText: "sort.Strings(${1:arr})",
    detail: "sort",
    isSnippet: true
  },
  {
    label: "sort.Slice",
    kind: "Function",
    insertText: "sort.Slice(${1:s}, func(i, j int) bool {\n\treturn ${1:s}[i] < ${1:s}[j]\n})",
    detail: "sort",
    isSnippet: true
  },
  {
    label: "sort.Search",
    kind: "Function",
    insertText: "sort.Search(${1:n}, func(i int) bool {\n\treturn ${2:condition}\n})",
    detail: "sort",
    isSnippet: true
  },
  {
    label: "strconv.Atoi",
    kind: "Function",
    insertText: "strconv.Atoi(${1:s})",
    detail: "strconv",
    isSnippet: true
  },
  {
    label: "strconv.Itoa",
    kind: "Function",
    insertText: "strconv.Itoa(${1:n})",
    detail: "strconv",
    isSnippet: true
  },
  {
    label: "strings.Split",
    kind: "Function",
    insertText: 'strings.Split(${1:s}, "${2: }")',
    detail: "strings",
    isSnippet: true
  },
  {
    label: "strings.Join",
    kind: "Function",
    insertText: 'strings.Join(${1:arr}, "${2: }")',
    detail: "strings",
    isSnippet: true
  },
  {
    label: "strings.Contains",
    kind: "Function",
    insertText: 'strings.Contains(${1:s}, "${2:sub}")',
    detail: "strings",
    isSnippet: true
  },
  {
    label: "math.Max",
    kind: "Function",
    insertText: "math.Max(${1:a}, ${2:b})",
    detail: "math",
    isSnippet: true
  },
  {
    label: "math.Min",
    kind: "Function",
    insertText: "math.Min(${1:a}, ${2:b})",
    detail: "math",
    isSnippet: true
  },
  {
    label: "math.Abs",
    kind: "Function",
    insertText: "math.Abs(${1:x})",
    detail: "math",
    isSnippet: true
  },
  {
    label: "math.Sqrt",
    kind: "Function",
    insertText: "math.Sqrt(${1:x})",
    detail: "math",
    isSnippet: true
  },
  { label: "math.MaxInt64", kind: "Constant", insertText: "math.MaxInt64", detail: "math" },
  {
    label: "make (slice)",
    kind: "Snippet",
    insertText: "make([]${1:int}, ${2:n})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "make (map)",
    kind: "Snippet",
    insertText: "make(map[${1:string}]${2:int})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "append",
    kind: "Function",
    insertText: "append(${1:slice}, ${2:val})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "len",
    kind: "Function",
    insertText: "len(${1})",
    detail: "builtin",
    isSnippet: true
  },
  {
    label: "cap",
    kind: "Function",
    insertText: "cap(${1})",
    detail: "builtin",
    isSnippet: true
  }
];

// ─── Rust ───
const rustCompletions: CompletionEntry[] = [
  // I/O
  {
    label: "println!",
    kind: "Function",
    insertText: 'println!("${1}");',
    detail: "macro",
    isSnippet: true
  },
  {
    label: "eprintln!",
    kind: "Function",
    insertText: 'eprintln!("${1}");',
    detail: "macro",
    isSnippet: true
  },
  {
    label: "format!",
    kind: "Function",
    insertText: 'format!("${1}")',
    detail: "macro",
    isSnippet: true
  },
  {
    label: "read line",
    kind: "Snippet",
    insertText:
      "let mut ${1:input} = String::new();\nstd::io::stdin().read_line(&mut ${1:input}).unwrap();\nlet ${1:input} = ${1:input}.trim();",
    detail: "stdin pattern",
    isSnippet: true
  },
  // Use
  {
    label: "use std::io",
    kind: "Snippet",
    insertText: "use std::io::{self, Read};",
    detail: "import"
  },
  {
    label: "use std::collections",
    kind: "Snippet",
    insertText: "use std::collections::${1:HashMap};",
    detail: "import",
    isSnippet: true
  },
  // Collections
  {
    label: "Vec",
    kind: "Class",
    insertText: "Vec<${1:i64}>",
    detail: "std::vec",
    isSnippet: true
  },
  {
    label: "vec!",
    kind: "Function",
    insertText: "vec![${1}]",
    detail: "macro",
    isSnippet: true
  },
  {
    label: "HashMap",
    kind: "Class",
    insertText: "HashMap<${1:String}, ${2:i64}>",
    detail: "std::collections",
    isSnippet: true
  },
  {
    label: "HashSet",
    kind: "Class",
    insertText: "HashSet<${1:i64}>",
    detail: "std::collections",
    isSnippet: true
  },
  {
    label: "BTreeMap",
    kind: "Class",
    insertText: "BTreeMap<${1:i64}, ${2:i64}>",
    detail: "std::collections",
    isSnippet: true
  },
  {
    label: "BTreeSet",
    kind: "Class",
    insertText: "BTreeSet<${1:i64}>",
    detail: "std::collections",
    isSnippet: true
  },
  {
    label: "VecDeque",
    kind: "Class",
    insertText: "VecDeque<${1:i64}>",
    detail: "std::collections",
    isSnippet: true
  },
  {
    label: "BinaryHeap",
    kind: "Class",
    insertText: "BinaryHeap<${1:i64}>",
    detail: "std::collections",
    isSnippet: true
  },
  // Iterators
  { label: ".iter()", kind: "Function", insertText: ".iter()", detail: "iterator" },
  {
    label: ".iter().map()",
    kind: "Function",
    insertText: ".iter().map(|${1:x}| ${2})",
    detail: "iterator",
    isSnippet: true
  },
  {
    label: ".iter().filter()",
    kind: "Function",
    insertText: ".iter().filter(|${1:x}| ${2})",
    detail: "iterator",
    isSnippet: true
  },
  {
    label: ".iter().collect()",
    kind: "Function",
    insertText: ".iter().collect::<${1:Vec<_>>>()",
    detail: "iterator",
    isSnippet: true
  },
  {
    label: ".iter().sum()",
    kind: "Function",
    insertText: ".iter().sum::<${1:i64}>()",
    detail: "iterator",
    isSnippet: true
  },
  {
    label: ".iter().enumerate()",
    kind: "Function",
    insertText: ".iter().enumerate()",
    detail: "iterator"
  },
  // Sort
  { label: ".sort()", kind: "Function", insertText: ".sort();", detail: "slice" },
  {
    label: ".sort_by()",
    kind: "Function",
    insertText: ".sort_by(|a, b| ${1:a.cmp(b)});",
    detail: "slice",
    isSnippet: true
  },
  {
    label: ".sort_unstable()",
    kind: "Function",
    insertText: ".sort_unstable();",
    detail: "slice"
  },
  // Parse
  {
    label: ".parse()",
    kind: "Function",
    insertText: ".parse::<${1:i64}>().unwrap()",
    detail: "str",
    isSnippet: true
  },
  { label: ".trim()", kind: "Function", insertText: ".trim()", detail: "str" },
  {
    label: ".split_whitespace()",
    kind: "Function",
    insertText: ".split_whitespace()",
    detail: "str"
  },
  // Numeric
  { label: "i64::MAX", kind: "Constant", insertText: "i64::MAX", detail: "numeric" },
  { label: "i64::MIN", kind: "Constant", insertText: "i64::MIN", detail: "numeric" },
  { label: "usize::MAX", kind: "Constant", insertText: "usize::MAX", detail: "numeric" }
];

// ─── JavaScript ───
const jsCompletions: CompletionEntry[] = [
  {
    label: "readline (node)",
    kind: "Snippet",
    insertText:
      "const readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nconst lines = [];\nrl.on('line', l => lines.push(l));\nrl.on('close', () => {\n\t${1}\n});",
    detail: "input pattern",
    isSnippet: true
  },
  {
    label: "console.log",
    kind: "Function",
    insertText: "console.log(${1});",
    detail: "global",
    isSnippet: true
  },
  {
    label: "Math.min",
    kind: "Function",
    insertText: "Math.min(${1})",
    detail: "Math",
    isSnippet: true
  },
  {
    label: "Math.max",
    kind: "Function",
    insertText: "Math.max(${1})",
    detail: "Math",
    isSnippet: true
  },
  {
    label: "Math.abs",
    kind: "Function",
    insertText: "Math.abs(${1})",
    detail: "Math",
    isSnippet: true
  },
  {
    label: "Math.floor",
    kind: "Function",
    insertText: "Math.floor(${1})",
    detail: "Math",
    isSnippet: true
  },
  {
    label: "Math.ceil",
    kind: "Function",
    insertText: "Math.ceil(${1})",
    detail: "Math",
    isSnippet: true
  },
  {
    label: "Math.sqrt",
    kind: "Function",
    insertText: "Math.sqrt(${1})",
    detail: "Math",
    isSnippet: true
  },
  {
    label: "Number.MAX_SAFE_INTEGER",
    kind: "Constant",
    insertText: "Number.MAX_SAFE_INTEGER",
    detail: "Number"
  },
  {
    label: "parseInt",
    kind: "Function",
    insertText: "parseInt(${1}, 10)",
    detail: "global",
    isSnippet: true
  },
  {
    label: "Array.from",
    kind: "Function",
    insertText: "Array.from({ length: ${1:n} }, (_, i) => ${2:i})",
    detail: "Array",
    isSnippet: true
  },
  { label: "new Map()", kind: "Class", insertText: "new Map()", detail: "global" },
  { label: "new Set()", kind: "Class", insertText: "new Set()", detail: "global" }
];

// ─── TypeScript (extend JS) ───
const tsCompletions: CompletionEntry[] = [...jsCompletions];

const completionsByLanguage: Record<string, CompletionEntry[]> = {
  c: cCompletions,
  cpp: cppCompletions,
  go: goCompletions,
  java: javaCompletions,
  javascript: jsCompletions,
  python: pythonCompletions,
  rust: rustCompletions,
  typescript: tsCompletions
};

let registered = false;

export function registerCompletionProviders(monaco: typeof Monaco) {
  if (registered) return;
  registered = true;

  for (const [lang, entries] of Object.entries(completionsByLanguage)) {
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems(_model, position) {
        const word = _model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions: Monaco.languages.CompletionItem[] = entries.map((e) => ({
          label: e.label,
          kind: kindMap[e.kind] as unknown as Monaco.languages.CompletionItemKind,
          insertText: e.insertText,
          ...(e.isSnippet
            ? { insertTextRules: 4 as unknown as Monaco.languages.CompletionItemInsertTextRule }
            : {}),
          ...(e.detail ? { detail: e.detail } : {}),
          range
        }));

        return { suggestions };
      }
    });
  }
}
