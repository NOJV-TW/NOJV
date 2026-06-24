<script lang="ts">
  import { ShieldCheck, XCircle } from "@lucide/svelte";

  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Card } from "$lib/components/primitives/ui/card";

  let { data, form } = $props();

  const result = $derived(form ?? data);
</script>

<svelte:head>
  <title>NOJV</title>
</svelte:head>

<div class="flex min-h-[60vh] items-center justify-center px-4">
  <Card variant="elevated" size="hero" class="w-full max-w-sm text-center">
    {#if result.status === "confirm"}
      <form method="POST" use:enhance class="flex flex-col items-center gap-4">
        <input type="hidden" name="token" value={result.token} />
        <div class="flex h-16 w-16 items-center justify-center rounded-lg bg-primary/15">
          <ShieldCheck class="h-8 w-8 text-primary" aria-hidden="true" />
        </div>
        <h1 class="text-title-lg font-semibold">確認啟用兩步驟驗證</h1>
        <p class="text-body-sm text-muted-foreground">確認後請回到設定頁面繼續完成啟用。</p>
        <Button type="submit" variant="default">確認</Button>
      </form>
    {:else}
      <div class="flex flex-col items-center gap-4">
        <div class="flex h-16 w-16 items-center justify-center rounded-lg bg-destructive/15">
          <XCircle class="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>
        <h1 class="text-title-lg font-semibold text-destructive">連結無效或已過期</h1>
        <p class="text-body-sm text-muted-foreground">請回到設定頁面重新寄送確認信。</p>
        <Button href="/account/two-factor" variant="outline">返回設定</Button>
      </div>
    {/if}
  </Card>
</div>
