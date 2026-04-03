<script lang="ts">
  interface Props {
    tags: string[];
    placeholder?: string;
  }

  let { tags = $bindable(), placeholder = "" }: Props = $props();
  let input = $state("");
  let inputEl: HTMLInputElement;

  function add(raw: string) {
    const tag = raw.trim();
    if (tag.length > 0 && !tags.includes(tag)) {
      tags = [...tags, tag];
    }
    input = "";
  }

  function remove(index: number) {
    tags = tags.filter((_, i) => i !== index);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if ((event.key === " " || event.key === "Enter") && input.trim().length > 0) {
      event.preventDefault();
      add(input);
    }
    if (event.key === "Backspace" && input === "" && tags.length > 0) {
      tags = tags.slice(0, -1);
    }
  }
</script>

<div
  class="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-2"
  onclick={() => inputEl?.focus()}
  role="textbox"
  tabindex="-1"
  onkeydown={() => {}}
>
  {#each tags as tag, index (tag)}
    <span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
      {tag}
      <button class="ml-0.5 text-primary/60 hover:text-primary" onclick={() => remove(index)} type="button">&times;</button>
    </span>
  {/each}
  <input
    bind:this={inputEl}
    class="min-w-[120px] flex-1 bg-transparent py-1 text-sm outline-none"
    oninput={(e) => (input = (e.target as HTMLInputElement).value)}
    onkeydown={handleKeyDown}
    {placeholder}
    value={input}
  />
</div>
