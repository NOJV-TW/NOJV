<script lang="ts">
  import { supportedLanguages, type Language } from "@nojv/core";
  import type { ProblemEditorialEntry } from "$lib/types";
  import { m } from "$lib/paraglide/messages.js";
  import { fetchWithCsrf } from "$lib/services/http";
  import MarkdownRenderer from "$lib/components/layout/MarkdownRenderer.svelte";
  import ImageDropZone from "$lib/components/ui/ImageDropZone.svelte";

  interface Props {
    problemId: string;
    /**
     * Whether the viewer has at least one accepted submission. Editorials are
     * gated behind solving the problem to keep spoiler exposure intentional.
     */
    hasAc: boolean;
    /** Whether this panel is the currently-visible tab — controls lazy fetch. */
    active: boolean;
    /** Unique DOM id suffix so two panels can coexist on the same page. */
    formIdSuffix?: string;
  }

  let { problemId, hasAc, active, formIdSuffix = "" }: Props = $props();

  let editorials = $state<ProblemEditorialEntry[]>([]);
  let editorialsLoaded = $state(false);
  let editorialsLoading = $state(false);
  let showEditorialForm = $state(false);
  let editorialContent = $state("");
  let editorialLanguage = $state<Language>("python");
  let editorialSubmitting = $state(false);

  const editorialLanguageId = $derived(
    `editorial-language${formIdSuffix ? `-${formIdSuffix}` : ""}`
  );

  async function loadEditorials() {
    if (editorialsLoading) return;
    editorialsLoading = true;
    try {
      const res = await fetch(`/api/problems/${problemId}/editorials`);
      if (res.ok) {
        editorials = await res.json();
        editorialsLoaded = true;
      }
    } finally {
      editorialsLoading = false;
    }
  }

  async function submitEditorial() {
    if (editorialSubmitting) return;
    editorialSubmitting = true;
    try {
      const res = await fetchWithCsrf(`/api/problems/${problemId}/editorials`, {
        method: "POST",
        body: JSON.stringify({ content: editorialContent, language: editorialLanguage })
      });
      if (res.ok) {
        showEditorialForm = false;
        editorialContent = "";
        await loadEditorials();
      }
    } finally {
      editorialSubmitting = false;
    }
  }

  // Fetch when the tab becomes active and the user has solved the problem.
  $effect(() => {
    if (active && hasAc && !editorialsLoaded && !editorialsLoading) {
      void loadEditorials();
    }
  });
</script>

<div class="p-5">
  {#if !hasAc}
    <p class="py-8 text-center text-body-sm text-muted-foreground">
      {m.editorials_solveFirst()}
    </p>
  {:else if editorialsLoading && !editorialsLoaded}
    <div class="flex items-center justify-center py-8">
      <div
        class="size-5 animate-spin rounded-full border-2 border-border border-t-foreground"
      ></div>
    </div>
  {:else}
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-body-sm font-semibold">{m.editorials_title()}</h2>
      <button
        class="rounded-md bg-primary px-3 py-1.5 text-caption font-medium text-primary-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90"
        onclick={() => (showEditorialForm = !showEditorialForm)}
        type="button"
      >
        {m.editorials_write()}
      </button>
    </div>

    {#if showEditorialForm}
      <div class="mb-6 rounded-md border border-border-subtle p-4">
        <div class="mb-3">
          <label
            class="mb-1 block text-caption font-medium text-muted-foreground"
            for={editorialLanguageId}
          >
            {m.editorials_language()}
          </label>
          <select
            id={editorialLanguageId}
            class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-body-sm"
            bind:value={editorialLanguage}
          >
            {#each supportedLanguages as lang (lang)}
              <option value={lang}>{lang}</option>
            {/each}
          </select>
        </div>
        <div class="mb-3">
          <ImageDropZone
            class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-body-sm leading-6"
            rows="10"
            name="editorialContent"
            placeholder={m.editorials_contentPlaceholder()}
            bind:value={editorialContent}
          />
        </div>
        <button
          class="rounded-md bg-primary px-4 py-1.5 text-caption font-medium text-primary-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90 disabled:opacity-50"
          disabled={editorialSubmitting || editorialContent.length < 10}
          onclick={submitEditorial}
          type="button"
        >
          {editorialSubmitting ? m.editorials_submitting() : m.editorials_submit()}
        </button>
      </div>
    {/if}

    {#if editorials.length === 0}
      <p class="py-8 text-center text-body-sm text-muted-foreground">
        {m.editorials_empty()}
      </p>
    {:else}
      <div class="grid gap-4">
        {#each editorials as editorial (editorial.id)}
          <div class="rounded-md border border-border-subtle p-4">
            <div class="mb-3 flex items-center gap-2 text-caption text-muted-foreground">
              <span>{m.editorials_by()} {editorial.user.name ?? editorial.user.username}</span>
              <span class="rounded-full bg-muted px-2 py-0.5 font-medium">
                {editorial.language}
              </span>
              <span class="tabular-nums">{new Date(editorial.createdAt).toLocaleDateString()}</span>
            </div>
            <div class="text-body-sm leading-7">
              <MarkdownRenderer content={editorial.content} />
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
