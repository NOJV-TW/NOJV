<script lang="ts">
  import {
    entryFileNameFor,
    languageSchema,
    supportedLanguages,
    type Language,
    type ProblemType,
  } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import { languageLabel } from "$lib/utils/language-labels";

  interface Props {
    value: Language;
    allowedLanguages?: Language[] | undefined;
    problemType: ProblemType;
    workspaceFiles: ProblemDetail["workspaceFiles"];
    onchange: (next: Language) => void;
    onavailablechange?: (available: Language[]) => void;
  }

  let {
    value,
    allowedLanguages,
    problemType,
    workspaceFiles,
    onchange,
    onavailablechange,
  }: Props = $props();

  let availableLanguages = $derived.by(() => {
    let langs = [...supportedLanguages];
    if (allowedLanguages && allowedLanguages.length > 0) {
      langs = langs.filter((l) => allowedLanguages!.includes(l));
    }
    if (problemType === "multi_file" && workspaceFiles.length > 0) {
      langs = langs.filter((l) => {
        const entry = entryFileNameFor(l);
        return workspaceFiles.some(
          (f) => f.language === l && f.path === entry && f.visibility === "editable",
        );
      });
    }
    return langs;
  });

  $effect(() => {
    onavailablechange?.(availableLanguages);
  });

  $effect(() => {
    if (availableLanguages.length > 0 && !availableLanguages.includes(value)) {
      onchange(availableLanguages[0]!);
    }
  });
</script>

<select
  class="border-0 bg-transparent px-1 py-0.5 text-micro font-medium text-foreground outline-none focus:ring-0"
  onchange={(e) => {
    const parsed = languageSchema.safeParse((e.target as HTMLSelectElement).value);
    if (parsed.success) onchange(parsed.data);
  }}
  {value}
>
  {#each availableLanguages as entry (entry)}
    <option value={entry}>{languageLabel(entry)}</option>
  {/each}
</select>
