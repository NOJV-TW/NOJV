<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { supportedLanguages, type Language } from "@nojv/core";
  import type { TemplateInfo } from "$lib/types";

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-border bg-white/60 px-3 py-3 text-sm";
  const monoTextareaClassName = `${inputClassName} min-h-24 resize-y font-mono`;

  interface Props {
    submissionType: "full_source" | "function";
    templatesByLang: Partial<Record<Language, TemplateInfo>>;
    starterByLang: Partial<Record<Language, string>>;
  }

  let {
    submissionType,
    templatesByLang = $bindable(),
    starterByLang = $bindable()
  }: Props = $props();

  let activeTemplateLang = $state<Language>("cpp");
  let activeStarterLang = $state<Language>("cpp");

  function getTemplate(lang: Language): TemplateInfo {
    return templatesByLang[lang] ?? { driverCode: "", templateCode: "", insertionMarker: "// __USER_CODE__" };
  }

  function updateTemplate(lang: Language, patch: Partial<TemplateInfo>) {
    const current = getTemplate(lang);
    templatesByLang = { ...templatesByLang, [lang]: { ...current, ...patch } };
  }

  function getStarter(lang: Language): string {
    return starterByLang[lang] ?? "";
  }

  function updateStarter(lang: Language, code: string) {
    starterByLang = { ...starterByLang, [lang]: code };
  }
</script>

<!-- Starter Code (full_source mode) -->
{#if submissionType === "full_source"}
  <div class="mt-2 border-t border-border pt-5">
    <p class="text-sm font-bold">{m.admin_starterCode()}</p>
    <p class="mt-1 text-xs text-muted-foreground">
      {m.admin_fullSource()}
    </p>

    <div class="mt-3 flex gap-1 border-b border-border">
      {#each supportedLanguages as lang (lang)}
        <button
          class="px-3 py-1.5 text-xs font-medium transition {activeStarterLang === lang
            ? 'border-b-2 border-primary text-foreground'
            : 'text-stone-400 hover:text-stone-600'}"
          onclick={() => (activeStarterLang = lang)}
          type="button"
        >
          {lang}
        </button>
      {/each}
    </div>

    <textarea
      class="{monoTextareaClassName} mt-3 min-h-32"
      oninput={(e) => updateStarter(activeStarterLang, (e.target as HTMLTextAreaElement).value)}
      placeholder="// starter code for {activeStarterLang}"
      value={getStarter(activeStarterLang)}
    ></textarea>
  </div>
{/if}

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
          placeholder={"#include <bits/stdc++.h>\nusing namespace std;\n\n// __USER_CODE__\n\nint main() { ... }"}
          value={getTemplate(activeTemplateLang).driverCode}
        ></textarea>
      </label>

      <label class="text-sm text-muted-foreground">
        {m.admin_templateCode()}
        <textarea
          class="{monoTextareaClassName} min-h-28"
          oninput={(e) => updateTemplate(activeTemplateLang, { templateCode: (e.target as HTMLTextAreaElement).value })}
          placeholder={"int solve(int n) {\n  // your code here\n}"}
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
