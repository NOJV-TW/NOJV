<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    activeTab?: string;
    basic?: Snippet;
    submission?: Snippet;
    testcase?: Snippet;
    judge?: Snippet;
    scoring?: Snippet;
  }

  let {
    activeTab = $bindable("basic"),
    basic,
    submission,
    testcase,
    judge,
    scoring,
  }: Props = $props();

  const tabs = [
    { id: "basic", label: "題目資訊" },
    { id: "submission", label: "提交設定" },
    { id: "testcase", label: "測資管理" },
    { id: "judge", label: "判題設定" },
    { id: "scoring", label: "評分規則" },
  ];
</script>

<div>
  <nav class="flex gap-1 border-b border-border mb-6">
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
