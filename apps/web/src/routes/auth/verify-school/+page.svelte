<script lang="ts">
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
    class="max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-white p-8 text-center shadow-sm"
  >
    {#if data.status === "success"}
      <h1 class="text-xl font-bold text-green-600">驗證成功</h1>
      <p class="mt-2 text-sm">
        你的 NOJV 帳號已設定為 <strong>{data.handle}</strong>。你可以關閉此頁面。
      </p>
    {:else}
      <h1 class="text-xl font-bold text-red-600">驗證失敗</h1>
      <p class="mt-2 text-sm">{data.detail}</p>
    {/if}
  </div>
</div>
