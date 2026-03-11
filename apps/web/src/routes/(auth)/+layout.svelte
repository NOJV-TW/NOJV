<script lang="ts">
  import "../../app.css";
  import "$lib/i18n";
  import { isLoading } from "svelte-i18n";

  let { children } = $props();
</script>

{#if $isLoading}
  <p>Loading...</p>
{:else}
  <div class="flex min-h-screen items-center justify-center px-4">
    {@render children()}
  </div>
{/if}
