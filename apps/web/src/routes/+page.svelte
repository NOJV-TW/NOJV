<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";

  if (browser) {
    const preferred = navigator.language.startsWith("en") ? "en" : "zh-TW";
    goto(`/${preferred}`, { replaceState: true });
  }
</script>

<p>Redirecting...</p>
