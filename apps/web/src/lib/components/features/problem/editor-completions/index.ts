import type * as Monaco from "monaco-editor";

import { cCompletions } from "./c";
import { cppCompletions } from "./cpp";
import { goCompletions } from "./go";
import { javaCompletions } from "./java";
import { jsCompletions } from "./javascript";
import { pythonCompletions } from "./python";
import { rustCompletions } from "./rust";
import { tsCompletions } from "./typescript";

export interface CompletionEntry {
  label: string;
  kind: "Function" | "Keyword" | "Snippet" | "Class" | "Module" | "Constant";
  insertText: string;
  detail?: string;
  isSnippet?: boolean;
}

const kindMap: Record<CompletionEntry["kind"], Monaco.languages.CompletionItemKind> = {
  Class: 5,
  Constant: 21,
  Function: 1,
  Keyword: 17,
  Module: 8,
  Snippet: 27,
};

const INSERT_AS_SNIPPET: Monaco.languages.CompletionItemInsertTextRule = 4;

const completionsByLanguage: Record<string, CompletionEntry[]> = {
  c: cCompletions,
  cpp: cppCompletions,
  go: goCompletions,
  java: javaCompletions,
  javascript: jsCompletions,
  python: pythonCompletions,
  rust: rustCompletions,
  typescript: tsCompletions,
};

let leaseCount = 0;
let providerHandles: Monaco.IDisposable[] = [];

export function acquireCompletionProviders(monaco: typeof Monaco): () => void {
  leaseCount++;

  if (leaseCount === 1) {
    try {
      for (const [lang, entries] of Object.entries(completionsByLanguage)) {
        providerHandles.push(
          monaco.languages.registerCompletionItemProvider(lang, {
            provideCompletionItems(_model, position) {
              const word = _model.getWordUntilPosition(position);
              const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
              };

              const suggestions: Monaco.languages.CompletionItem[] = entries.map((e) => ({
                label: e.label,
                kind: kindMap[e.kind],
                insertText: e.insertText,
                ...(e.isSnippet ? { insertTextRules: INSERT_AS_SNIPPET } : {}),
                ...(e.detail ? { detail: e.detail } : {}),
                range,
              }));

              return { suggestions };
            },
          }),
        );
      }
    } catch (error) {
      for (const handle of providerHandles) handle.dispose();
      providerHandles = [];
      leaseCount--;
      throw error;
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    leaseCount--;
    if (leaseCount !== 0) return;
    for (const handle of providerHandles) handle.dispose();
    providerHandles = [];
  };
}
