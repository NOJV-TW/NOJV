<script lang="ts">
  import type { StagedFile } from "$lib/components/features/problem/advanced/AdvancedUploader.svelte";
  let { staged = $bindable<StagedFile | null>(null) } = $props();
</script>

<button
  onclick={() => {
    staged = {
      kind: "single",
      file: new File(["print(1)"], "main.py"),
      sourceFiles: [{ path: "main.py", content: "print(1)" }],
    };
  }}>Stage upload</button
>
