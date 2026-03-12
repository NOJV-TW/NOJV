<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ProblemCreationPanel from "$lib/components/problem/CreationPanel.svelte";

  let { data } = $props();
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {m.problems_createNew()}
  </h2>
  <ProblemCreationPanel formData={data.form} />
</div>
