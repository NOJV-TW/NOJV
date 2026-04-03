<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tooltip } from "bits-ui";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    activeTab?: string;
    disabledTabs?: string[];
    disabledTooltip?: string;
    basic?: Snippet;
    submission?: Snippet;
    testcase?: Snippet;
    judge?: Snippet;
    scoring?: Snippet;
  }

  let {
    activeTab = $bindable("basic"),
    disabledTabs = [],
    disabledTooltip = m.admin_tabDisabledTooltip(),
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
  <nav class="flex gap-1 border-b border-border mb-6">
    {#each tabs as tab (tab.id)}
      {@const disabled = disabledTabs.includes(tab.id)}
      {#if disabled}
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger
              class="px-4 py-2.5 text-sm font-medium relative text-muted-foreground/40 cursor-not-allowed"
              type="button"
              onclick={(e: MouseEvent) => e.preventDefault()}
            >
              {tab.label}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                class="z-50 max-w-xs rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                sideOffset={4}
              >
                {disabledTooltip}
                <Tooltip.Arrow class="fill-popover stroke-border" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      {:else}
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
      {/if}
    {/each}
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
