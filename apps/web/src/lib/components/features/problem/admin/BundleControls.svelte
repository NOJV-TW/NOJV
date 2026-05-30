<script lang="ts">
  import { Download, Upload } from "@lucide/svelte";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import { toasts } from "$lib/stores/toast";
  import StorageBudgetBar from "./StorageBudgetBar.svelte";

  interface Props {
    problemId: string;
    refreshToken: number;
    onuploaded?: () => void;
  }

  let { problemId, refreshToken, onuploaded }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  let importing = $state(false);

  async function onImportChange() {
    const file = fileInput?.files?.[0];
    if (!file) return;
    importing = true;
    try {
      const res = await fetch(`/api/problems/${problemId}/bundle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "X-Requested-With": "fetch",
        },
        body: file,
      });
      if (res.ok) {
        toasts.add({ message: m.bundle_importSuccess(), type: "success" });
        onuploaded?.();
        await invalidateAll();
      } else {
        const msg = await safeMessage(res);
        toasts.add({ message: msg ?? m.bundle_importFailed(), type: "error" });
      }
    } catch {
      toasts.add({ message: m.bundle_importFailed(), type: "error" });
    } finally {
      importing = false;
      if (fileInput) fileInput.value = "";
    }
  }

  async function safeMessage(res: Response): Promise<string | null> {
    try {
      const data = (await res.json()) as { message?: string };
      return data.message ?? null;
    } catch {
      return null;
    }
  }
</script>

<section
  class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <h2 class="text-body-sm font-semibold">{m.bundle_title()}</h2>
      <p class="mt-0.5 text-caption text-muted-foreground">
        {m.bundle_hint()}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <input
        bind:this={fileInput}
        type="file"
        accept=".zip,application/zip"
        class="sr-only"
        onchange={onImportChange}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={importing}
        onclick={() => fileInput?.click()}
      >
        <Upload class="h-4 w-4" aria-hidden="true" />
        {importing ? m.bundle_importing() : m.bundle_import()}
      </Button>
      <a
        class="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-caption font-medium text-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-accent"
        href={`/api/problems/${problemId}/bundle`}
        download
      >
        <Download class="h-4 w-4" aria-hidden="true" />
        {m.bundle_export()}
      </a>
    </div>
  </div>
  <div class="mt-4">
    <StorageBudgetBar {problemId} {refreshToken} />
  </div>
</section>
