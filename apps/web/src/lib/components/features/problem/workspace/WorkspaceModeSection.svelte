<script lang="ts">
  import type { ProblemType } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";

  export type WorkspaceMode = Exclude<ProblemType, "special_env">;

  interface Props {
    mode: WorkspaceMode;
  }

  let { mode = $bindable() }: Props = $props();

  const options = [
    {
      id: "full_source" as const,
      title: m.admin_workspaceModeFullSourceTitle(),
      desc: m.admin_workspaceModeFullSourceDesc()
    },
    {
      id: "multi_file" as const,
      title: m.admin_workspaceModeMultiFileTitle(),
      desc: m.admin_workspaceModeMultiFileDesc()
    }
  ];
</script>

<section class="rounded-lg border border-border-subtle p-2">
  <h3 class="text-body-sm font-semibold">{m.admin_workspaceModeTitle()}</h3>
  <p class="mt-0.5 text-caption text-muted-foreground">{m.admin_workspaceModeHint()}</p>

  <div class="mt-3 grid gap-3 md:grid-cols-2">
    {#each options as option (option.id)}
      <button
        type="button"
        class="flex flex-col items-start gap-1 rounded-lg border p-1 text-left transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:-translate-y-0.5 {mode ===
        option.id
          ? 'border-primary bg-primary/5 shadow-rest'
          : 'border-border bg-[color:var(--color-panel)] hover:border-primary/50'}"
        aria-pressed={mode === option.id}
        onclick={() => (mode = option.id)}
      >
        <span class="flex items-center gap-2 text-body-sm font-semibold">
          <span
            class="flex size-4 items-center justify-center rounded-full border-2 {mode ===
            option.id
              ? 'border-primary'
              : 'border-border'}"
            aria-hidden="true"
          >
            {#if mode === option.id}
              <span class="size-2 rounded-full bg-primary"></span>
            {/if}
          </span>
          {option.title}
        </span>
        <span class="text-caption leading-relaxed text-muted-foreground">{option.desc}</span>
      </button>
    {/each}
  </div>
</section>
