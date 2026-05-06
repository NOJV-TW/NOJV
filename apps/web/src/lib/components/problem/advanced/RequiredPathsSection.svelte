<script lang="ts">
  import { Folder, FileText, X, Plus } from "@lucide/svelte";
  import { requiredPathSchema } from "@nojv/core";
  import { inputClassName } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    value: string[];
    onchange: (next: string[]) => void;
    onsave: () => void | Promise<void>;
  }

  let { value, onchange, onsave }: Props = $props();

  let draft = $state("");
  let error = $state<string | null>(null);
  let dirty = $state(false);
  let saving = $state(false);

  function isFolder(path: string): boolean {
    return path.endsWith("/");
  }

  function tryAdd() {
    const candidate = draft.trim();
    if (candidate.length === 0) return;
    const parsed = requiredPathSchema.safeParse(candidate);
    if (!parsed.success) {
      error = m.advancedRequiredPaths_errorInvalid();
      return;
    }
    if (value.includes(parsed.data)) {
      error = m.advancedRequiredPaths_errorDuplicate();
      return;
    }
    error = null;
    onchange([...value, parsed.data]);
    draft = "";
    dirty = true;
  }

  function remove(index: number) {
    const next = value.slice();
    next.splice(index, 1);
    onchange(next);
    dirty = true;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      tryAdd();
    }
  }

  async function save() {
    saving = true;
    try {
      await onsave();
      dirty = false;
    } finally {
      saving = false;
    }
  }
</script>

<section class="space-y-6">
  <header class="space-y-1">
    <h3 class="text-body-lg font-semibold">{m.advancedRequiredPaths_label()}</h3>
    <p class="text-body-sm text-muted-foreground">
      {m.advancedRequiredPaths_hint()}
    </p>
  </header>

  <div class="space-y-3">
    <div class="flex flex-wrap items-start gap-2">
      <div class="flex-1 min-w-[16rem]">
        <div class="flex gap-2">
          <input
            type="text"
            class={inputClassName}
            spellcheck="false"
            autocomplete="off"
            placeholder={m.advancedRequiredPaths_addPlaceholder()}
            bind:value={draft}
            onkeydown={onKeydown}
            oninput={() => (error = null)}
          />
          <button
            type="button"
            class="mt-2 inline-flex items-center gap-1 rounded-2xl border border-border bg-[color:var(--color-panel)] px-4 text-body-sm font-medium transition-[background-color] duration-fast ease-out-soft hover:bg-accent disabled:opacity-50"
            onclick={tryAdd}
            disabled={draft.trim().length === 0}
          >
            <Plus class="h-4 w-4" />
            {m.advancedRequiredPaths_addButton()}
          </button>
        </div>
        <p class="mt-1 text-caption text-muted-foreground">
          {m.advancedRequiredPaths_caseSensitiveNote()}
        </p>
        {#if error}
          <p class="mt-1 text-caption text-destructive">{error}</p>
        {/if}
      </div>
    </div>

    {#if value.length === 0}
      <p class="text-caption text-muted-foreground">
        {m.advancedRequiredPaths_emptyHelp()}
      </p>
    {:else}
      <ul class="flex flex-wrap gap-2">
        {#each value as path, i (path)}
          <li
            class="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1 text-body-sm"
          >
            {#if isFolder(path)}
              <Folder
                class="h-4 w-4 text-muted-foreground"
                aria-label={m.advancedRequiredPaths_folderBadge()}
              />
            {:else}
              <FileText
                class="h-4 w-4 text-muted-foreground"
                aria-label={m.advancedRequiredPaths_fileBadge()}
              />
            {/if}
            <span class="font-mono text-caption">{path}</span>
            <button
              type="button"
              class="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color] duration-fast ease-out-soft hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${path}`}
              onclick={() => remove(i)}
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="flex justify-end">
    <button
      type="button"
      class="rounded-full bg-primary px-5 py-2 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90 disabled:opacity-50"
      disabled={saving || !dirty}
      onclick={save}
    >
      {saving ? m.admin_savingImage() : m.advancedRequiredPaths_saveButton()}
    </button>
  </div>
</section>
