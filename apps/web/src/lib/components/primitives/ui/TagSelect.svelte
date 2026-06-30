<script lang="ts">
  import { Popover } from "bits-ui";
  import { Check, ChevronDown, Plus } from "@lucide/svelte";
  import { problemTags } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    tags: string[];
    placeholder?: string;
  }

  let { tags = $bindable(), placeholder = "" }: Props = $props();

  const ALL_TAGS: readonly string[] = problemTags;

  let open = $state(false);
  let search = $state("");

  $effect(() => {
    const valid = tags.filter((tag) => ALL_TAGS.includes(tag));
    if (valid.length !== tags.length) tags = valid;
  });

  const filtered = $derived(
    ALL_TAGS.filter((tag) => tag.toLowerCase().includes(search.trim().toLowerCase())),
  );

  function toggle(tag: string) {
    if (tags.includes(tag)) {
      tags = tags.filter((t) => t !== tag);
    } else {
      tags = [...tags, tag];
    }
  }

  function remove(tag: string) {
    tags = tags.filter((t) => t !== tag);
  }
</script>

<div class="space-y-2">
  {#if tags.length > 0}
    <div class="flex flex-wrap gap-1.5">
      {#each tags as tag (tag)}
        <span
          class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
        >
          {tag}
          <button
            class="ml-0.5 text-primary/60 hover:text-primary"
            onclick={() => remove(tag)}
            type="button"
            aria-label={`remove ${tag}`}>&times;</button
          >
        </span>
      {/each}
    </div>
  {/if}

  <Popover.Root bind:open>
    <Popover.Trigger
      class="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:border-primary/40 hover:text-foreground"
    >
      <span class="inline-flex items-center gap-1.5">
        <Plus class="size-4" />
        {placeholder || m.admin_tagsPlaceholder()}
      </span>
      <ChevronDown class="size-4 opacity-60" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        class="z-50 w-(--bits-popover-anchor-width) min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        sideOffset={4}
        align="start"
      >
        <input
          class="mb-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
          placeholder={m.admin_tagsSearch()}
          bind:value={search}
        />
        <ul class="max-h-64 overflow-y-auto">
          {#each filtered as tag (tag)}
            {@const selected = tags.includes(tag)}
            <li>
              <button
                class="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onclick={() => toggle(tag)}
                type="button"
              >
                <span>{tag}</span>
                {#if selected}
                  <Check class="size-4 text-primary" />
                {/if}
              </button>
            </li>
          {/each}
          {#if filtered.length === 0}
            <li class="px-2 py-3 text-center text-caption text-muted-foreground">
              {m.admin_tagsNoMatch()}
            </li>
          {/if}
        </ul>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
</div>
