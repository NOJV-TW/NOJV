<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { authClient } from "$lib/auth.client";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { toasts } from "$lib/stores/toast";

  let { data, form } = $props();

  let busy = $state(false);
  let error = $state("");
  let needsReauth = $state(false);
  let passkeyBusy = $state(false);

  const providerLabel: Record<string, string> = { github: "GitHub", google: "Google" };

  async function addPasskey() {
    error = "";
    passkeyBusy = true;
    try {
      const res = await authClient.passkey.addPasskey({
        name: `Passkey ${data.passkeys.length + 1}`,
      });
      if (res?.error) {
        error = res.error.message ?? "無法新增 passkey。";
        return;
      }
      toasts.success("已新增 passkey");
      await invalidateAll();
    } catch {
      error = "無法新增 passkey。";
    } finally {
      passkeyBusy = false;
    }
  }
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <div class="flex flex-col gap-1">
        <h1 class="text-title-lg">登入方式</h1>
        <p class="text-body-sm text-muted-foreground">
          綁定 Google 或 GitHub,之後任一種都能登入同一個帳號。
        </p>
      </div>
    {/snippet}
    {#if needsReauth}
      <p class="text-body-sm text-warning">為了安全,請先重新登入再變更登入方式。</p>
    {/if}
    {#if error}
      <p class="text-body-sm text-destructive">{error}</p>
    {/if}
    <div class="flex flex-col gap-3">
      {#each data.providers as { provider, linked } (provider)}
        <Card variant="surface" class="flex items-center justify-between gap-4 p-4">
          <span class="text-body-sm font-medium">{providerLabel[provider] ?? provider}</span>
          <form
            method="POST"
            action={linked ? "?/unlink" : "?/link"}
            use:enhance={() => {
              error = "";
              needsReauth = false;
              busy = true;
              return async ({ result, update }) => {
                busy = false;
                if (result.type === "failure") {
                  needsReauth = result.data?.needsReauth === true;
                  error = needsReauth ? "" : ((result.data?.error as string) ?? "");
                  return;
                }
                if (result.type === "success" && result.data?.unlinked) {
                  toasts.success(`已移除 ${providerLabel[provider] ?? provider}`);
                }
                await update();
              };
            }}
          >
            <input type="hidden" name="provider" value={provider} />
            <button
              type="submit"
              disabled={busy}
              class="rounded-md border px-3 py-1.5 text-caption font-medium {linked
                ? 'border-destructive/40 text-destructive'
                : 'border-border'}"
            >
              {linked ? "解除綁定" : "綁定"}
            </button>
          </form>
        </Card>
      {/each}
    </div>

    <div class="mt-6 flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h2 class="text-title-sm">Passkey</h2>
        <p class="text-body-sm text-muted-foreground">
          用裝置的生物辨識或 PIN 進行敏感操作驗證,不需密碼,適用任何登入方式。
        </p>
      </div>
      {#each data.passkeys as passkey (passkey.id)}
        <Card variant="surface" class="flex items-center justify-between gap-4 p-4">
          <span class="text-body-sm font-medium">{passkey.name}</span>
          <form
            method="POST"
            action="?/deletePasskey"
            use:enhance={() => {
              error = "";
              needsReauth = false;
              busy = true;
              return async ({ result, update }) => {
                busy = false;
                if (result.type === "failure") {
                  needsReauth = result.data?.needsReauth === true;
                  error = needsReauth ? "" : ((result.data?.error as string) ?? "");
                  return;
                }
                toasts.success("已移除 passkey");
                await update();
              };
            }}
          >
            <input type="hidden" name="id" value={passkey.id} />
            <button
              type="submit"
              disabled={busy}
              class="rounded-md border border-destructive/40 px-3 py-1.5 text-caption font-medium text-destructive"
            >
              移除
            </button>
          </form>
        </Card>
      {/each}
      <button
        type="button"
        onclick={addPasskey}
        disabled={passkeyBusy}
        class="self-start rounded-md border border-border px-3 py-1.5 text-caption font-medium"
      >
        新增 passkey
      </button>
    </div>
  </Section>
</PageContainer>
