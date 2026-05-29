<script lang="ts">
  import { supportedLanguages, type Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import type { WorkspaceMode } from "./WorkspaceModeSection.svelte";

  interface Props {
    allowedLanguages: Language[];
    mode: WorkspaceMode;
    hasEntryFileForLanguage: (lang: Language) => boolean;
  }

  let {
    allowedLanguages = $bindable(),
    mode,
    hasEntryFileForLanguage
  }: Props = $props();

  function toggleLanguage(lang: Language) {
    allowedLanguages = allowedLanguages.includes(lang)
      ? allowedLanguages.filter((l) => l !== lang)
      : [...allowedLanguages, lang];
  }
</script>

<section class="rounded-lg border border-border-subtle p-2">
  <h3 class="text-body-sm font-semibold">{m.admin_allowedLanguages()}</h3>
  <p class="mt-0.5 text-caption text-muted-foreground">{m.admin_allowedLanguagesHint()}</p>
  <div class="mt-3 flex flex-wrap gap-2">
    {#each supportedLanguages as lang (lang)}
      {@const checked = allowedLanguages.includes(lang)}
      {@const missingTemplate =
        mode === "multi_file" && checked && !hasEntryFileForLanguage(lang)}
      <label
        class="flex items-center gap-2 rounded-full border px-3 py-1 text-caption transition-[background-color,border-color] duration-fast ease-out-soft {checked
          ? missingTemplate
            ? 'border-warning/60 bg-warning/10 text-warning'
            : 'border-primary bg-primary/5 text-foreground'
          : 'border-border text-muted-foreground'}"
      >
        <input
          type="checkbox"
          class="accent-primary"
          {checked}
          onchange={() => toggleLanguage(lang)}
        />
        <span>{lang}</span>
        {#if missingTemplate}
          <span
            class="inline-flex size-1.5 rounded-full bg-warning"
            aria-label={m.admin_workspaceLanguageMissing()}
          ></span>
        {/if}
      </label>
    {/each}
  </div>
</section>
