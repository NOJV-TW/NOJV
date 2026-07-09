<script lang="ts">
  import { onMount } from "svelte";
  import { maybeAutostartStudentTour } from "$lib/onboarding/student-tour";

  onMount(() => maybeAutostartStudentTour());
</script>
