<script lang="ts">
  import { Tabs } from "$lib/components/primitives/ui/tabs";

  let active = $state("submissions");
</script>

<Tabs tabs={[{ key: "submissions", label: "提交紀錄" }]} bind:value={active} label="管理分頁">
  {#snippet actions()}
    <input aria-label="搜尋學號或 IP" />
  {/snippet}
  <p>表格內容</p>
</Tabs>
