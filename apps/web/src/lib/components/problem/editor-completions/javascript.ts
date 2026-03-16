import type { CompletionEntry } from "./index";

export const jsCompletions: CompletionEntry[] = [
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
