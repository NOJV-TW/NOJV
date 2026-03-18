import type { CompletionEntry } from "./index";

export const cCompletions: CompletionEntry[] = [
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
