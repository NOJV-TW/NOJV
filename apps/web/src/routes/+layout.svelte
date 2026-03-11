<script lang="ts">
  import "../app.css";
  import "$lib/i18n";
  import { isLoading } from "svelte-i18n";

  let { children } = $props();
</script>

{#if $isLoading}
  <p>Loading...</p>
{:else}
  {@render children()}
{/if}
