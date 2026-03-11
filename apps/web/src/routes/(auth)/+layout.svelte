<script lang="ts">
  import "../../app.css";

  let { children } = $props();
</script>

<div class="flex min-h-screen items-center justify-center px-4">
  {@render children()}
</div>
