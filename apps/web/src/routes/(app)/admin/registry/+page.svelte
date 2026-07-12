<script lang="ts">
  import { enhance } from "$app/forms";
  import { Database, Trash2 } from "@lucide/svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Card } from "$lib/components/primitives/ui/card";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/components/primitives/ui/toast";

  let { data } = $props();

  function shortDigest(digest: string | null): string {
    if (!digest) return "—";
    const hex = digest.includes(":") ? (digest.split(":")[1] ?? digest) : digest;
    return hex.slice(0, 12);
  }

  function formatSize(bytes: number | null): string {
    if (bytes === null) return "—";
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
    if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  let pending = $state<{
    form: HTMLFormElement;
    title: string;
    message: string;
    confirmText: string;
    variant: "default" | "danger";
  } | null>(null);

  function requestConfirm(
    e: MouseEvent,
    cfg: { title: string; message: string; confirmText: string; variant: "default" | "danger" },
  ) {
    e.preventDefault();
    const form = (e.currentTarget as HTMLButtonElement).form;
    if (!form) return;
    pending = { form, ...cfg };
  }

  function runConfirm() {
    const form = pending?.form;
    pending = null;
    form?.requestSubmit();
  }

  function deleteResult(repo: string, tag: string) {
    return async ({
      result,
      update,
    }: {
      result: { type: string; data?: Record<string, unknown> };
      update: () => Promise<void>;
    }) => {
      if (result.type === "success") {
        toasts.success(m.admin_registry_deleteSuccess({ repo, tag }));
        await update();
      } else if (result.type === "failure") {
        const err =
          (result.data as { error?: string } | undefined)?.error ??
          m.admin_registry_deleteFailed();
        toasts.error(err);
      } else {
        await update();
      }
    };
  }

  function gcResult() {
    return async ({
      result,
      update,
    }: {
      result: { type: string; data?: Record<string, unknown> };
      update: () => Promise<void>;
    }) => {
      if (result.type === "success") {
        if ((result.data as { alreadyRunning?: boolean } | undefined)?.alreadyRunning) {
          toasts.info(m.admin_registry_gcAlreadyRunning());
        } else {
          toasts.success(m.admin_registry_gcStarted());
        }
        await update();
      } else if (result.type === "failure") {
        const err =
          (result.data as { error?: string } | undefined)?.error ?? m.admin_registry_gcFailed();
        toasts.error(err);
      } else {
        await update();
      }
    };
  }
</script>

<PageContainer class="space-y-4">
  <header class="animate-in flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-title-lg font-semibold">{m.admin_registry_title()}</h1>
      <p class="text-caption text-muted-foreground">{m.admin_registry_subtitle()}</p>
    </div>
    {#if data.configured}
      <form method="POST" action="?/triggerGc" use:enhance={gcResult}>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          onclick={(e) =>
            requestConfirm(e, {
              title: m.admin_registry_gcConfirmTitle(),
              message: m.admin_registry_gcConfirm(),
              confirmText: m.admin_registry_gc(),
              variant: "default",
            })}
        >
          <Trash2 aria-hidden="true" class="h-3.5 w-3.5" />
          {m.admin_registry_gc()}
        </Button>
      </form>
    {/if}
  </header>

  {#if !data.configured}
    <Card variant="surface" size="lg" class="overflow-hidden p-0">
      <EmptyState
        variant="minimal"
        icon={Database}
        title={m.admin_registry_notConfigured()}
        description={m.admin_registry_notConfiguredHint()}
      />
    </Card>
  {:else if data.repositories.length === 0}
    <Card variant="surface" size="lg" class="overflow-hidden p-0">
      <EmptyState
        variant="minimal"
        icon={Database}
        title={m.admin_registry_empty()}
        description={m.admin_registry_emptyHint()}
      />
    </Card>
  {:else}
    <p class="text-caption text-muted-foreground">{m.admin_registry_noPushTimeNote()}</p>
    {#each data.repositories as repo (repo.repo)}
      <Card variant="surface" size="lg" class="overflow-hidden p-0">
        <div class="border-b border-border-subtle px-5 py-3">
          <h2 class="font-mono text-body-sm font-medium">{repo.repo}</h2>
        </div>
        {#if repo.tags.length === 0}
          <p class="px-5 py-6 text-center text-caption text-muted-foreground">
            {m.admin_registry_noTags()}
          </p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-body-sm">
              <thead>
                <tr
                  class="border-b border-border-subtle text-left text-caption uppercase tracking-wider text-muted-foreground"
                >
                  <th class="px-5 py-2 font-medium">{m.admin_registry_colTag()}</th>
                  <th class="px-5 py-2 font-medium">{m.admin_registry_colSize()}</th>
                  <th class="px-5 py-2 font-medium">{m.admin_registry_colDigest()}</th>
                  <th class="px-5 py-2 text-right font-medium"
                    >{m.admin_registry_colActions()}</th
                  >
                </tr>
              </thead>
              <tbody>
                {#each repo.tags as t (t.tag)}
                  <tr class="border-b border-border-subtle last:border-b-0">
                    <td class="px-5 py-3 font-mono">{t.tag}</td>
                    <td class="px-5 py-3 text-muted-foreground">{formatSize(t.size)}</td>
                    <td class="px-5 py-3 font-mono text-caption text-muted-foreground">
                      {shortDigest(t.digest)}
                    </td>
                    <td class="px-5 py-3 text-right">
                      {#if t.digest}
                        <form
                          method="POST"
                          action="?/deleteTag"
                          use:enhance={() => deleteResult(repo.repo, t.tag)}
                        >
                          <input type="hidden" name="repo" value={repo.repo} />
                          <input type="hidden" name="digest" value={t.digest} />
                          <input type="hidden" name="tag" value={t.tag} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            class="text-destructive hover:bg-destructive/10"
                            onclick={(e) =>
                              requestConfirm(e, {
                                title: m.admin_registry_deleteConfirmTitle(),
                                message: `${m.admin_registry_deleteConfirm({ repo: repo.repo, tag: t.tag })} ${m.admin_registry_sharedDigestWarning()}`,
                                confirmText: m.admin_registry_deleteTag(),
                                variant: "danger",
                              })}
                          >
                            <Trash2 aria-hidden="true" class="h-3.5 w-3.5" />
                            {m.admin_registry_deleteTag()}
                          </Button>
                        </form>
                      {:else}
                        <span class="text-caption text-muted-foreground">—</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </Card>
    {/each}
  {/if}
</PageContainer>

<ConfirmDialog
  open={pending !== null}
  title={pending?.title ?? ""}
  message={pending?.message ?? ""}
  confirmText={pending?.confirmText ?? m.common_confirm()}
  variant={pending?.variant ?? "default"}
  onconfirm={runConfirm}
  oncancel={() => (pending = null)}
/>
