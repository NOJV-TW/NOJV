<script lang="ts">
  import { problemTags } from "@nojv/core";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    tags: string[];
  }

  let { tags = $bindable() }: Props = $props();

  const ALL_TAGS: readonly string[] = problemTags;

  $effect(() => {
    const valid = tags.filter((tag) => ALL_TAGS.includes(tag));
    if (valid.length !== tags.length) tags = valid;
  });

  function toggle(tag: string) {
    if (tags.includes(tag)) {
      tags = tags.filter((t) => t !== tag);
    } else {
      tags = [...tags, tag];
    }
  }
</script>

<div class="flex flex-wrap gap-2" role="group">
  {#each ALL_TAGS as tag (tag)}
    {@const selected = tags.includes(tag)}
    <button
      type="button"
      aria-pressed={selected}
      onclick={() => toggle(tag)}
      class={cn(
        "rounded-full border px-3 py-1 text-caption font-medium transition-[color,background-color,border-color] duration-fast ease-out-soft",
        selected
          ? "border-primary bg-primary text-white"
          : "border-border bg-[color:var(--color-panel)] text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      {tag}
    </button>
  {/each}
</div>
