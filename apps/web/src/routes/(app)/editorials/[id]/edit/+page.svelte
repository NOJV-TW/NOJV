<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { supportedLanguages, type Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import ImageDropZone from "$lib/components/primitives/ui/ImageDropZone.svelte";
  import { toasts } from "$lib/stores/toast";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";

  let { data } = $props();

  // Seed editor state from `data` once. Re-loads (e.g. after navigating
  // back from a successful save) hit a fresh component instance, so we
  // do not need to reactively re-sync.
  let content = $state(untrack(() => data.editorial.content));
  let language = $state<Language>(untrack(() => data.editorial.language));
  let saving = $state(false);

  const dirty = $derived(
    content !== data.editorial.content || language !== data.editorial.language
  );
  const valid = $derived(content.length >= 10 && content.length <= 50000);

  async function save() {
    if (!dirty || !valid || saving) return;
    saving = true;
    try {
      const res = await fetch(`/api/editorials/${data.editorial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ content, language })
      });
      if (res.ok) {
        toasts.add({ type: "success", message: m.editorial_savedToast() });
        const target = data.problem
          ? `/problems/${data.problem.id}/editorials`
          : `/problems/${data.editorial.problemId}/editorials`;
        await goto(target);
      } else {
        toasts.add({ type: "error", message: m.editorial_saveError() });
      }
    } catch {
      toasts.add({ type: "error", message: m.editorial_saveError() });
    } finally {
      saving = false;
    }
  }
</script>

<Section>
  {#snippet header()}
    <h1 class="text-title-lg">{m.editorial_editTitle()}</h1>
    {#if data.problem}
      <p>
        <a href="/problems/{data.problem.id}/editorials" class="text-primary hover:underline">
          ← {formatProblemDisplayName(data.problem)}
        </a>
      </p>
    {/if}
  {/snippet}

  <div class="grid gap-4">
    <div>
      <label
        class="mb-1 block text-caption font-medium text-muted-foreground"
        for="editorial-edit-language"
      >
        {m.editorials_language()}
      </label>
      <select
        id="editorial-edit-language"
        class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-body-sm"
        bind:value={language}
      >
        {#each supportedLanguages as lang (lang)}
          <option value={lang}>{lang}</option>
        {/each}
      </select>
    </div>
    <div>
      <label
        class="mb-1 block text-caption font-medium text-muted-foreground"
        for="editorial-edit-content"
      >
        {m.editorial_contentLabel()}
      </label>
      <ImageDropZone
        id="editorial-edit-content"
        class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-body-sm leading-6"
        rows="20"
        name="content"
        bind:value={content}
      />
      <p class="mt-1 text-micro text-muted-foreground tabular-nums">
        {content.length} / 50000
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="rounded-md bg-primary px-4 py-1.5 text-caption font-medium text-primary-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        disabled={!dirty || !valid || saving}
        onclick={save}
      >
        {saving ? m.editorial_saving() : m.editorial_save()}
      </button>
      <a
        href={data.problem
          ? `/problems/${data.problem.id}/editorials`
          : `/problems/${data.editorial.problemId}/editorials`}
        class="rounded-md border border-border px-4 py-1.5 text-caption font-medium transition-[background-color,border-color] duration-fast ease-out-soft hover:bg-accent"
      >
        {m.common_cancel()}
      </a>
    </div>
  </div>
</Section>
