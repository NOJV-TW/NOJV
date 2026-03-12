<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  let { data } = $props();

  // Notify the account page via BroadcastChannel on success
  $effect(() => {
    if (data.status !== "success") return;

    try {
      const bc = new BroadcastChannel("nojv-school-verify");
      bc.postMessage({ type: "verified", handle: data.handle });
      bc.close();
    } catch {
      // BroadcastChannel not supported — no-op
    }
  });
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="max-w-sm rounded-[2rem] border border-border bg-[color:var(--color-panel)] p-8 text-center shadow-sm backdrop-blur-sm"
  >
    {#if data.status === "success"}
      <h1 class="text-xl font-bold text-green-600">{m.verifySchool_success()}</h1>
      <p class="mt-2 text-sm">
        {m.verifySchool_successMessage({ handle: data.handle })}
      </p>
    {:else}
      <h1 class="text-xl font-bold text-red-600">{m.verifySchool_failed()}</h1>
      <p class="mt-2 text-sm">{data.detail}</p>
    {/if}
  </div>
</div>
