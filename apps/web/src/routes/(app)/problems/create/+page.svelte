<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ProblemTabs from "$lib/components/problem/ProblemTabs.svelte";
  import BasicInfoTab from "$lib/components/problem/tabs/BasicInfoTab.svelte";

  let { data } = $props();

  const disabledTabs = ["submission", "testcase", "judge", "scoring"];
</script>

<div class="mx-auto max-w-4xl space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {m.problems_createNew()}
  </h2>

  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <ProblemTabs {disabledTabs}>
      {#snippet basic()}
        <BasicInfoTab formData={data.form} mode="create" />
      {/snippet}
    </ProblemTabs>
  </section>
</div>
