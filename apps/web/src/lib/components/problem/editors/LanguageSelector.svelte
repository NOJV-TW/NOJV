<script lang="ts">
  import {
    entryFileNameFor,
    languageSchema,
    supportedLanguages,
    type Language,
    type ProblemType
  } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";

  interface Props {
    /** Current language. Two-way via the `onchange` callback. */
    value: Language;
    /**
     * Hard restriction from the contest / assignment context. When present,
     * any language outside this list is unavailable even if the problem
     * itself supports it.
     */
    allowedLanguages?: Language[] | undefined;
    /**
     * Problem type — determines whether workspace-file filtering applies.
     * Only `multi_file` requires every available language to have an editable
     * entry file in `workspaceFiles`.
     */
    problemType: ProblemType;
    /**
     * Workspace-file mode: if the problem ships workspace files, we only
     * expose languages that have an editable `main.<ext>` entry file —
     * otherwise the student could pick a language they can't submit in.
     */
    workspaceFiles: ProblemDetail["workspaceFiles"];
    /** Fires whenever the student picks a different language. */
    onchange: (next: Language) => void;
    /** Optional: parent can mirror the computed list for its own gating. */
    onavailablechange?: (available: Language[]) => void;
  }

  let {
    value,
    allowedLanguages,
    problemType,
    workspaceFiles,
    onchange,
    onavailablechange
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
          (f) =>
            f.language === l && f.path === entry && f.visibility === "editable"
        );
      });
    }
    return langs;
  });

  // Mirror the computed list up to the parent so it can disable buttons
  // when nothing is runnable.
  $effect(() => {
    onavailablechange?.(availableLanguages);
  });

  // If the current selection falls outside the available set (language
  // filter toggled, or workspace files changed shape), snap to the first
  // available entry so the editor doesn't get stuck on an invalid choice.
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
    <option value={entry}>{entry}</option>
  {/each}
</select>
