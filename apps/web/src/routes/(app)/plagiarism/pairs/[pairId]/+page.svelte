<script lang="ts">
  import PlagiarismPairDiff from "$lib/components/features/plagiarism/PlagiarismPairDiff.svelte";

  let { data } = $props();
</script>

<PlagiarismPairDiff {data} />
