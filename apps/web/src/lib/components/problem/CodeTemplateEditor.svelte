<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { supportedLanguages, type Language, type SubmissionType } from "@nojv/core";
  import type { TemplateInfo } from "$lib/types";
  import { inputClassName, monoTextareaClassName } from "$lib/utils";

  interface Props {
    submissionType: SubmissionType;
    templatesByLang: Partial<Record<Language, TemplateInfo>>;
  }

  let {
    submissionType,
    templatesByLang = $bindable()
  }: Props = $props();

  let activeTemplateLang = $state<Language>("cpp");

  const placeholders: Record<Language, { driverCode: string; templateCode: string; insertionMarker: string }> = {
    c: {
      driverCode: '#include <stdio.h>\n\n// __USER_CODE__\n\nint main() { ... }',
      templateCode: 'int solve(int n) {\n  // your code here\n}',
      insertionMarker: '// __USER_CODE__'
    },
    cpp: {
      driverCode: '#include <bits/stdc++.h>\nusing namespace std;\n\n// __USER_CODE__\n\nint main() { ... }',
      templateCode: 'int solve(int n) {\n  // your code here\n}',
      insertionMarker: '// __USER_CODE__'
    },
    go: {
      driverCode: 'package main\n\nimport "fmt"\n\n// __USER_CODE__\n\nfunc main() { ... }',
      templateCode: 'func solve(n int) int {\n\t// your code here\n}',
      insertionMarker: '// __USER_CODE__'
    },
    java: {
      driverCode: 'import java.util.*;\n\npublic class Main {\n  // __USER_CODE__\n\n  public static void main(String[] args) { ... }\n}',
      templateCode: 'static int solve(int n) {\n  // your code here\n}',
      insertionMarker: '// __USER_CODE__'
    },
    javascript: {
      driverCode: '// __USER_CODE__\n\nconst input = ...;\nconsole.log(solve(input));',
      templateCode: 'function solve(n) {\n  // your code here\n}',
      insertionMarker: '// __USER_CODE__'
    },
    python: {
      driverCode: '# __USER_CODE__\n\nn = int(input())\nprint(solve(n))',
      templateCode: 'def solve(n: int) -> int:\n    # your code here\n    pass',
      insertionMarker: '# __USER_CODE__'
    },
    rust: {
      driverCode: 'use std::io;\n\n// __USER_CODE__\n\nfn main() { ... }',
      templateCode: 'fn solve(n: i32) -> i32 {\n    // your code here\n}',
      insertionMarker: '// __USER_CODE__'
    },
    typescript: {
      driverCode: '// __USER_CODE__\n\nconst input = ...;\nconsole.log(solve(input));',
      templateCode: 'function solve(n: number): number {\n  // your code here\n}',
      insertionMarker: '// __USER_CODE__'
    }
  };

  function getTemplate(lang: Language): TemplateInfo {
    return templatesByLang[lang] ?? { driverCode: "", templateCode: "", insertionMarker: placeholders[lang].insertionMarker };
  }

  function updateTemplate(lang: Language, patch: Partial<TemplateInfo>) {
    const current = getTemplate(lang);
    templatesByLang = { ...templatesByLang, [lang]: { ...current, ...patch } };
  }
</script>

<!-- Template Editor (function mode) -->
{#if submissionType === "function"}
  <div class="mt-2 border-t border-border pt-5">
    <p class="text-sm font-bold">{m.admin_functionTemplate()}</p>
    <p class="mt-1 text-xs text-muted-foreground">
      {m.admin_templatePreviewHint()}
    </p>

    <div class="mt-3 flex gap-1 border-b border-border">
      {#each supportedLanguages as lang (lang)}
        <button
          class="px-3 py-1.5 text-xs font-medium transition {activeTemplateLang === lang
            ? 'border-b-2 border-primary text-foreground'
            : 'text-stone-400 hover:text-stone-600'}"
          onclick={() => (activeTemplateLang = lang)}
          type="button"
        >
          {lang}
        </button>
      {/each}
    </div>

    <div class="mt-3 grid gap-4">
      <label class="text-sm text-muted-foreground">
        {m.admin_driverCode()}
        <textarea
          class="{monoTextareaClassName} min-h-36"
          oninput={(e) => updateTemplate(activeTemplateLang, { driverCode: (e.target as HTMLTextAreaElement).value })}
          placeholder={placeholders[activeTemplateLang].driverCode}
          value={getTemplate(activeTemplateLang).driverCode}
        ></textarea>
      </label>

      <label class="text-sm text-muted-foreground">
        {m.admin_templateCode()}
        <textarea
          class="{monoTextareaClassName} min-h-28"
          oninput={(e) => updateTemplate(activeTemplateLang, { templateCode: (e.target as HTMLTextAreaElement).value })}
          placeholder={placeholders[activeTemplateLang].templateCode}
          value={getTemplate(activeTemplateLang).templateCode}
        ></textarea>
      </label>

      <label class="text-sm text-muted-foreground">
        {m.admin_insertionMarker()}
        <input
          class="{inputClassName} font-mono"
          oninput={(e) => updateTemplate(activeTemplateLang, { insertionMarker: (e.target as HTMLInputElement).value })}
          value={getTemplate(activeTemplateLang).insertionMarker}
        />
      </label>
    </div>
  </div>
{/if}
