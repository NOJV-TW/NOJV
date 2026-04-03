<script lang="ts">
  import type { Snippet } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Tooltip } from "bits-ui";

  interface Props {
    activeTab?: string;
    canPublish?: boolean;
    showPublish?: boolean;
    publishing?: boolean;
    onpublish?: () => void;
    basic?: Snippet;
    submission?: Snippet;
    testcase?: Snippet;
    judge?: Snippet;
    scoring?: Snippet;
  }

  let {
    activeTab = $bindable("basic"),
    canPublish = false,
    showPublish = false,
    publishing = false,
    onpublish,
    basic,
    submission,
    testcase,
    judge,
    scoring,
  }: Props = $props();

  const tabs = [
    { id: "basic", label: m.admin_tabBasicInfo() },
    { id: "submission", label: m.admin_tabSubmission() },
    { id: "testcase", label: m.admin_tabTestcase() },
    { id: "judge", label: m.admin_tabJudge() },
    { id: "scoring", label: m.admin_tabScoring() },
  ];
</script>

<div>
  <nav class="flex items-center border-b border-border mb-6">
    <div class="flex gap-1">
      {#each tabs as tab (tab.id)}
        <button
          class="px-4 py-2.5 text-sm font-medium transition-colors relative
            {activeTab === tab.id
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = tab.id)}
          type="button"
        >
          {tab.label}
          {#if activeTab === tab.id}
            <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></span>
          {/if}
        </button>
      {/each}
    </div>

    {#if showPublish}
      <div class="ml-auto">
        {#if canPublish}
          <button
            class="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={publishing}
            type="button"
            onclick={() => onpublish?.()}
          >
            {publishing ? m.admin_publishingProblem() : m.admin_publishProblem()}
          </button>
        {:else}
          <Tooltip.Provider delayDuration={200}>
            <Tooltip.Root>
              <Tooltip.Trigger
                class="rounded-full bg-muted px-4 py-1.5 text-sm font-semibold text-muted-foreground/50 cursor-not-allowed"
                type="button"
                onclick={(e: MouseEvent) => e.preventDefault()}
              >
                {m.admin_publishProblem()}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  class="z-50 max-w-xs rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                  sideOffset={4}
                >
                  {m.admin_publishTooltip()}
                  <Tooltip.Arrow class="fill-popover stroke-border" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        {/if}
      </div>
    {/if}
  </nav>

  {#if activeTab === "basic" && basic}
    {@render basic()}
  {:else if activeTab === "submission" && submission}
    {@render submission()}
  {:else if activeTab === "testcase" && testcase}
    {@render testcase()}
  {:else if activeTab === "judge" && judge}
    {@render judge()}
  {:else if activeTab === "scoring" && scoring}
    {@render scoring()}
  {/if}
</div>
