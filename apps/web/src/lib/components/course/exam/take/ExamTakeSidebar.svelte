<script lang="ts" module>
  export type ProbStatus = "done" | "attempted" | "flagged" | undefined;

  export interface SidebarProblem {
    id: string;
    letter: string;
    title: string;
  }
</script>

<script lang="ts">
  import { ChevronLeft, Flag, Check } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    problems: SidebarProblem[];
    activeId: string;
    statusMap: Record<string, ProbStatus>;
    collapsed: boolean;
    onToggle: () => void;
    onSelect: (id: string) => void;
  }

  let { problems, activeId, statusMap, collapsed, onToggle, onSelect }: Props = $props();
</script>

<aside
  class="overflow-y-auto border-r border-border-subtle"
  style="background: color-mix(in oklab, var(--muted) 50%, transparent);"
>
  <div
    class="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-3"
  >
    {#if !collapsed}
      <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
        {m.examTake_problemsHeading({ count: problems.length })}
      </div>
    {/if}
    <button
      type="button"
      onclick={onToggle}
      title={collapsed ? m.examTake_expandSidebar() : m.examTake_collapseSidebar()}
      class="ml-auto grid size-7 place-items-center rounded-md border border-border-subtle text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      <span style:transform={collapsed ? "rotate(180deg)" : "none"} class="inline-flex">
        <ChevronLeft class="size-3" />
      </span>
    </button>
  </div>

  <ul class="space-y-1 p-2">
    {#each problems as p (p.id)}
      {@const st = statusMap[p.id]}
      {@const isActive = activeId === p.id}
      <li>
        {#if collapsed}
          <button
            type="button"
            onclick={() => onSelect(p.id)}
            title={`${p.letter}. ${p.title}`}
            class="grid w-full place-items-center rounded-md py-2 transition-colors {isActive
              ? ''
              : 'hover:bg-muted'}"
            style:background={isActive ? "var(--panel)" : undefined}
            style:border={isActive ? "1px solid var(--border)" : "1px solid transparent"}
          >
            <span class="font-mono text-caption font-semibold tabular-nums">{p.letter}</span>
            <span class="mt-1">
              {#if st === "done"}
                <span
                  class="inline-flex size-4 items-center justify-center rounded-full"
                  style="background: color-mix(in oklab, var(--success) 22%, transparent); color: oklch(0.45 0.13 160);"
                >
                  <Check class="size-3" strokeWidth={3} />
                </span>
              {:else if st === "flagged"}
                <Flag class="size-3" style="color: var(--primary);" />
              {:else if st === "attempted"}
                <span class="size-2 rounded-full" style="background: var(--chart-4);"></span>
              {:else}
                <span
                  class="size-2 rounded-full"
                  style="background: var(--border-strong); opacity: 0.6;"
                ></span>
              {/if}
            </span>
          </button>
        {:else}
          <button
            type="button"
            onclick={() => onSelect(p.id)}
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors {isActive
              ? ''
              : 'hover:bg-muted'}"
            style:background={isActive ? "var(--panel)" : undefined}
            style:border={isActive ? "1px solid var(--border)" : undefined}
          >
            <span class="w-8 font-mono text-caption font-semibold text-muted-foreground">
              {p.letter}.
            </span>
            <span class="flex-1 truncate text-body-sm">{p.title}</span>
            {#if st === "done"}
              <span
                class="inline-flex size-5 items-center justify-center rounded-full"
                style="background: color-mix(in oklab, var(--success) 22%, transparent); color: oklch(0.45 0.13 160);"
              >
                <Check class="size-3" strokeWidth={3} />
              </span>
            {:else if st === "flagged"}
              <Flag class="size-3" style="color: var(--primary);" />
            {:else if st === "attempted"}
              <span class="size-2 rounded-full" style="background: var(--chart-4);"></span>
            {:else}
              <span
                class="size-2 rounded-full"
                style="background: var(--border-strong); opacity: 0.6;"
              ></span>
            {/if}
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  {#if !collapsed}
    <div
      class="mx-3 mt-4 space-y-1.5 rounded-lg border border-border-subtle p-3 text-micro"
      style="background: var(--panel);"
    >
      <div class="mb-1.5 font-mono uppercase tracking-wider text-muted-foreground">
        {m.examTake_legendHeading()}
      </div>
      <div class="flex items-center gap-2 text-muted-foreground">
        <span
          class="inline-flex size-4 items-center justify-center rounded-full"
          style="background: color-mix(in oklab, var(--success) 22%, transparent); color: oklch(0.45 0.13 160);"
        >
          <Check class="size-3" strokeWidth={3} />
        </span>
        <span>{m.examTake_legendDone()}</span>
      </div>
      <div class="flex items-center gap-2 text-muted-foreground">
        <span class="size-2 rounded-full" style="background: var(--chart-4);"></span>
        <span>{m.examTake_legendAttempted()}</span>
      </div>
      <div class="flex items-center gap-2 text-muted-foreground">
        <Flag class="size-3" style="color: var(--primary);" />
        <span>{m.examTake_legendFlagged()}</span>
      </div>
      <div class="flex items-center gap-2 text-muted-foreground">
        <span
          class="size-2 rounded-full"
          style="background: var(--border-strong); opacity: 0.6;"
        ></span>
        <span>{m.examTake_legendUntouched()}</span>
      </div>
    </div>
  {/if}
</aside>
