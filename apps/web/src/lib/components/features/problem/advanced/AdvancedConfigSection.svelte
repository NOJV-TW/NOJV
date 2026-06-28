<script lang="ts">
  import { untrack } from "svelte";
  import { X, Plus } from "@lucide/svelte";
  import { inputClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";
  import type { AdvancedConfig, ImageRef, ProblemImageSource } from "@nojv/core";

  type NetworkMode = "none" | "allowlist" | "service";
  type ImageRole = "run" | "grade" | "service";

  interface Props {
    problemId: string;
    config: AdvancedConfig;
    timeLimitMs: number;
    memoryLimitMb: number;
    maxTotalTimeMs: number;
    onsave: (payload: {
      config: AdvancedConfig;
      timeLimitMs: number;
      memoryLimitMb: number;
    }) => Promise<{ ok: boolean; message?: string }>;
  }

  let { problemId, config, timeLimitMs, memoryLimitMb, maxTotalTimeMs, onsave }: Props =
    $props();

  let run = $state<ImageRef>(untrack(() => ({ ...config.run })));
  let grade = $state<ImageRef>(untrack(() => ({ ...config.grade })));
  let mode = $state<NetworkMode>(untrack(() => config.network.mode));
  let allowlist = $state<string[]>(untrack(() => [...(config.network.allowlist ?? [])]));
  let service = $state<ImageRef>(
    untrack(() =>
      config.network.service
        ? { ...config.network.service }
        : { imageRef: "", imageSource: "registry" },
    ),
  );
  let localTimeLimitMs = $state(untrack(() => timeLimitMs));
  let localMemoryLimitMb = $state(untrack(() => memoryLimitMb));

  let allowlistDraft = $state("");
  let allowlistError = $state<string | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  const uploading = $state<Record<ImageRole, boolean>>({
    run: false,
    grade: false,
    service: false,
  });
  const uploadError = $state<Record<ImageRole, string | null>>({
    run: null,
    grade: null,
    service: null,
  });

  function imageFor(role: ImageRole): ImageRef {
    if (role === "run") return run;
    if (role === "grade") return grade;
    return service;
  }

  function setSource(role: ImageRole, source: ProblemImageSource) {
    imageFor(role).imageSource = source;
  }

  async function uploadTarball(role: ImageRole, file: File) {
    uploading[role] = true;
    uploadError[role] = null;
    try {
      const body = new FormData();
      body.set("role", role);
      body.set("tarball", file);
      const res = await fetch(`/api/problems/${problemId}/advanced-image`, {
        method: "POST",
        headers: { "X-Requested-With": "fetch" },
        body,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => m.bundle_uploadFailed());
        throw new Error(msg || m.bundle_uploadFailed());
      }
      const payload = (await res.json()) as { key: string };
      const image = imageFor(role);
      image.imageSource = "tarball";
      image.imageRef = payload.key;
    } catch (err) {
      uploadError[role] = err instanceof Error ? err.message : m.bundle_uploadFailed();
    } finally {
      uploading[role] = false;
    }
  }

  function onPick(role: ImageRole, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void uploadTarball(role, file);
  }

  function addAllowlist() {
    const candidate = allowlistDraft.trim();
    if (candidate.length === 0) return;
    if (!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(candidate)) {
      allowlistError = m.advancedConfig_allowlistInvalid();
      return;
    }
    if (allowlist.includes(candidate)) {
      allowlistError = m.advancedConfig_allowlistDuplicate();
      return;
    }
    allowlistError = null;
    allowlist = [...allowlist, candidate];
    allowlistDraft = "";
  }

  function removeAllowlist(index: number) {
    allowlist = allowlist.filter((_, i) => i !== index);
  }

  function buildConfig(): AdvancedConfig | null {
    const network: AdvancedConfig["network"] =
      mode === "allowlist"
        ? { mode, allowlist }
        : mode === "service"
          ? { mode, service: { ...service } }
          : { mode };
    return { run: { ...run }, grade: { ...grade }, network };
  }

  async function save() {
    saveError = null;
    if (run.imageRef.trim() === "" || grade.imageRef.trim() === "") {
      saveError = m.advancedConfig_runGradeRequired();
      return;
    }
    if (mode === "allowlist" && allowlist.length === 0) {
      saveError = m.advancedConfig_allowlistRequired();
      return;
    }
    if (mode === "service" && service.imageRef.trim() === "") {
      saveError = m.advancedConfig_serviceRequired();
      return;
    }
    if (localTimeLimitMs > maxTotalTimeMs) {
      saveError = m.advancedConfig_timeLimitTooLarge({ max: String(maxTotalTimeMs) });
      return;
    }
    const next = buildConfig();
    if (!next) return;
    saving = true;
    try {
      const result = await onsave({
        config: next,
        timeLimitMs: localTimeLimitMs,
        memoryLimitMb: localMemoryLimitMb,
      });
      if (result && !result.ok) {
        saveError = result.message ?? m.admin_imageConfigFailed();
      }
    } finally {
      saving = false;
    }
  }

  const ROLE_LABELS: Record<ImageRole, () => string> = {
    run: m.advancedConfig_runImage,
    grade: m.advancedConfig_gradeImage,
    service: m.advancedConfig_serviceImage,
  };
</script>

{#snippet imagePicker(role: ImageRole)}
  {@const image = imageFor(role)}
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <span class="text-body-sm font-medium">{ROLE_LABELS[role]()}</span>
      <a
        href={`/api/problems/advanced-scaffold?role=${role}`}
        download
        class="shrink-0 rounded-full border border-border px-3 py-1 text-caption font-medium transition-[background-color] duration-fast ease-out-soft hover:bg-accent"
      >
        {m.advancedConfig_downloadScaffold()}
      </a>
    </div>
    <div class="flex gap-3">
      <label class="flex items-center gap-2 text-body-sm">
        <input
          type="radio"
          name={`adv-source-${role}-${problemId}`}
          value="registry"
          checked={image.imageSource === "registry"}
          onchange={() => setSource(role, "registry")}
        />
        {m.admin_imageSourceRegistry()}
      </label>
      <label class="flex items-center gap-2 text-body-sm">
        <input
          type="radio"
          name={`adv-source-${role}-${problemId}`}
          value="tarball"
          checked={image.imageSource === "tarball"}
          onchange={() => setSource(role, "tarball")}
        />
        {m.admin_imageSourceTarball()}
      </label>
    </div>

    {#if image.imageSource === "registry"}
      <input
        class={inputClassName}
        bind:value={image.imageRef}
        placeholder={m.admin_imageRefPlaceholder()}
        spellcheck="false"
        data-testid={`adv-ref-${role}`}
      />
    {:else}
      <div>
        <label
          class="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3 py-3 text-body-sm transition-[background-color] duration-fast ease-out-soft hover:bg-accent {uploading[
            role
          ]
            ? 'cursor-wait opacity-60'
            : ''}"
        >
          <span class="truncate font-mono text-caption text-muted-foreground">
            {uploading[role]
              ? m.admin_tarballUploading()
              : image.imageRef || m.admin_tarballDropHint()}
          </span>
          <span
            class="shrink-0 rounded-full border border-border px-3 py-1 text-caption font-medium"
          >
            {m.advancedConfig_chooseTarball()}
          </span>
          <input
            type="file"
            accept=".tar,.tar.gz"
            class="hidden"
            disabled={uploading[role]}
            onchange={(e) => onPick(role, e)}
          />
        </label>
        {#if uploadError[role]}
          <p class="mt-2 text-caption text-destructive">{uploadError[role]}</p>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<section class="space-y-6">
  <header class="space-y-2">
    <h3 class="text-body-lg font-semibold">{m.advancedConfig_title()}</h3>
    <p class="text-body-sm text-muted-foreground">{m.advancedConfig_hint()}</p>
    <details class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2">
      <summary class="cursor-pointer text-caption font-semibold">
        {m.advancedConfig_contractHelpTitle()}
      </summary>
      <p class="mt-2 whitespace-pre-line text-caption text-muted-foreground">
        {m.advancedConfig_contractHelpBody()}
      </p>
    </details>
  </header>

  <div class="grid gap-6 md:grid-cols-2">
    <div class="rounded-lg border border-border-subtle bg-muted/20 p-4">
      {@render imagePicker("run")}
    </div>
    <div class="rounded-lg border border-border-subtle bg-muted/20 p-4">
      {@render imagePicker("grade")}
    </div>
  </div>

  <div class="space-y-3">
    <span class="text-body-sm font-medium">{m.advancedConfig_networkMode()}</span>
    <p class="text-caption text-muted-foreground">{m.advancedConfig_networkHint()}</p>
    <div class="flex flex-wrap gap-3">
      {#each ["none", "allowlist", "service"] as const as value (value)}
        <label class="flex items-center gap-2 text-body-sm">
          <input
            type="radio"
            name={`adv-network-${problemId}`}
            {value}
            checked={mode === value}
            onchange={() => (mode = value)}
          />
          {value === "none"
            ? m.advancedConfig_modeNone()
            : value === "allowlist"
              ? m.advancedConfig_modeAllowlist()
              : m.advancedConfig_modeService()}
        </label>
      {/each}
    </div>
  </div>

  {#if mode === "allowlist"}
    <div class="space-y-3 rounded-lg border border-border-subtle bg-muted/20 p-4">
      <span class="text-body-sm font-medium">{m.advancedConfig_allowlistLabel()}</span>
      <p class="text-caption text-muted-foreground">{m.advancedConfig_allowlistHint()}</p>
      <div class="flex gap-2">
        <input
          type="text"
          class={inputClassName}
          spellcheck="false"
          autocomplete="off"
          placeholder={m.advancedConfig_allowlistPlaceholder()}
          bind:value={allowlistDraft}
          data-testid="allowlist-input"
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addAllowlist();
            }
          }}
          oninput={() => (allowlistError = null)}
        />
        <button
          type="button"
          class="mt-2 inline-flex items-center gap-1 rounded-xl border border-border bg-[color:var(--color-panel)] px-4 text-body-sm font-medium transition-[background-color] duration-fast ease-out-soft hover:bg-accent disabled:opacity-50"
          onclick={addAllowlist}
          disabled={allowlistDraft.trim().length === 0}
        >
          <Plus aria-hidden="true" class="h-4 w-4" />
          {m.advancedRequiredPaths_addButton()}
        </button>
      </div>
      {#if allowlistError}
        <p class="text-caption text-destructive">{allowlistError}</p>
      {/if}
      {#if allowlist.length > 0}
        <ul class="flex flex-wrap gap-2">
          {#each allowlist as host, i (host)}
            <li
              class="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1 text-body-sm"
              data-testid="allowlist-chip"
            >
              <span class="font-mono text-caption">{host}</span>
              <button
                type="button"
                class="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color] duration-fast ease-out-soft hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${host}`}
                onclick={() => removeAllowlist(i)}
              >
                <X aria-hidden="true" class="h-3.5 w-3.5" />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if mode === "service"}
    <div class="rounded-lg border border-border-subtle bg-muted/20 p-4">
      {@render imagePicker("service")}
    </div>
  {/if}

  <div class="grid gap-4 md:grid-cols-2">
    <label class="text-body-sm">
      <span class="text-body-sm font-medium">{m.admin_totalTimeLimitMs()}</span>
      <input
        type="number"
        class={inputClassName}
        min="1000"
        max={maxTotalTimeMs}
        bind:value={localTimeLimitMs}
      />
      <p class="mt-1 text-caption text-muted-foreground">
        {m.advancedConfig_timeLimitHint({ max: String(maxTotalTimeMs) })}
      </p>
    </label>
    <label class="text-body-sm">
      <span class="text-body-sm font-medium">{m.admin_memoryLimitMb()}</span>
      <input
        type="number"
        class={inputClassName}
        min="16"
        max="4096"
        bind:value={localMemoryLimitMb}
      />
    </label>
  </div>

  <div class="flex items-center justify-end gap-3">
    {#if saveError}
      <p class="text-caption text-destructive">{saveError}</p>
    {/if}
    <button
      type="button"
      class="rounded-full bg-primary px-5 py-2 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90 disabled:opacity-50"
      disabled={saving}
      onclick={save}
    >
      {saving ? m.admin_savingImage() : m.advancedConfig_save()}
    </button>
  </div>
</section>
