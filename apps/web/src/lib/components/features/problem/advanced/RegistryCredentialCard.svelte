<script lang="ts">
  import { deserialize } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import CopyButton from "$lib/components/primitives/ui/CopyButton.svelte";
  import { toasts } from "$lib/stores/toast";
  import { formatDateTime } from "$lib/utils/datetime";

  interface Props {
    registryHost: string;
    credential: {
      username: string;
      updatedAt: Date | string;
      lastUsedAt: Date | string | null;
    } | null;
  }

  let { registryHost, credential }: Props = $props();

  let generating = $state(false);
  let showRotateConfirm = $state(false);
  let issued = $state<{ username: string; password: string } | null>(null);

  async function generate() {
    generating = true;
    try {
      const res = await fetch("?/generateRegistryCredential", {
        method: "POST",
        body: new FormData(),
      });
      const result = deserialize(await res.text());
      if (
        result.type === "success" &&
        typeof result.data?.username === "string" &&
        typeof result.data?.password === "string"
      ) {
        issued = { username: result.data.username, password: result.data.password };
        await invalidateAll();
      } else if (result.type === "failure") {
        toasts.error(
          typeof result.data?.error === "string" ? result.data.error : m.error_unexpected(),
        );
      } else {
        toasts.error(m.error_unexpected());
      }
    } catch {
      toasts.error(m.error_unexpected());
    } finally {
      generating = false;
    }
  }

  function handleGenerateClick() {
    if (credential) {
      showRotateConfirm = true;
    } else {
      void generate();
    }
  }

  let loginSnippet = $derived(
    issued ? `docker login ${registryHost} -u ${issued.username}` : "",
  );
</script>

<div class="space-y-3">
  <div class="space-y-1">
    <h2 class="text-title-sm font-semibold">{m.registryCred_title()}</h2>
    <p class="text-body-sm text-muted-foreground">
      {m.registryCred_intro({ host: registryHost })}
    </p>
  </div>

  {#if issued}
    <div class="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p class="text-body-sm font-medium">{m.registryCred_passwordOnce()}</p>
      <div class="flex items-center gap-2">
        <code
          class="flex-1 overflow-x-auto rounded bg-black/85 px-3 py-2 text-caption text-white"
          >{issued.password}</code
        >
        <CopyButton text={issued.password} />
      </div>
      <div class="flex items-center gap-2">
        <code
          class="flex-1 overflow-x-auto rounded bg-black/85 px-3 py-2 text-caption text-white"
          >{loginSnippet}</code
        >
        <CopyButton text={loginSnippet} />
      </div>
      <p class="text-caption text-muted-foreground">
        {m.registryCred_namespaceHint({ host: registryHost, namespace: issued.username })}
      </p>
    </div>
  {:else if credential}
    <div class="space-y-1 text-body-sm text-muted-foreground">
      <p>
        {m.registryCred_username()}:
        <code class="rounded bg-muted px-1.5 py-0.5 font-mono">{credential.username}</code>
      </p>
      <p class="text-caption">
        {m.registryCred_updatedAt({ time: formatDateTime(credential.updatedAt) })}
        {#if credential.lastUsedAt}
          · {m.registryCred_lastUsedAt({ time: formatDateTime(credential.lastUsedAt) })}
        {/if}
      </p>
      <p class="text-caption">
        {m.registryCred_namespaceHint({ host: registryHost, namespace: credential.username })}
      </p>
    </div>
  {:else}
    <p class="text-body-sm text-muted-foreground">{m.registryCred_none()}</p>
  {/if}

  <Button
    variant="outline"
    size="sm"
    loading={generating}
    disabled={generating}
    onclick={handleGenerateClick}
  >
    {credential || issued ? m.registryCred_rotate() : m.registryCred_generate()}
  </Button>
</div>

<ConfirmDialog
  bind:open={showRotateConfirm}
  title={m.registryCred_rotateConfirmTitle()}
  message={m.registryCred_rotateConfirmMessage()}
  confirmText={m.registryCred_rotate()}
  cancelText={m.admin_cancel()}
  variant="danger"
  onconfirm={() => {
    showRotateConfirm = false;
    void generate();
  }}
  oncancel={() => (showRotateConfirm = false)}
/>
