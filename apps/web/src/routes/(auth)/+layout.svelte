<script lang="ts">
  let { children } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-50 to-orange-50/40 px-4">
  {@render children()}
</div>
