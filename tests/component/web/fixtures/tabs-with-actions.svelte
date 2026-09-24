<script lang="ts">
  import { Tabs } from "$lib/components/primitives/ui/tabs";

  let active = $state("submissions");
  let lastChanged = $state("");
</script>

<Tabs
  tabs={[
    { key: "submissions", label: "提交紀錄" },
    { key: "results", label: "成績" },
  ]}
  bind:value={active}
  onValueChange={(value) => (lastChanged = value)}
  label="管理分頁"
>
  {#snippet actions()}
    <input aria-label="搜尋學號或 IP" />
  {/snippet}
  <p>表格內容</p>
  <span data-tab-value={lastChanged}></span>
</Tabs>
