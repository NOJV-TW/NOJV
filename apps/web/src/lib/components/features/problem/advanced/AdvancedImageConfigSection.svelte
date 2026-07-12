<script lang="ts">
  import { untrack } from "svelte";
  import type { AdvancedConfig } from "@nojv/core";
  import { deserialize } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils/css";
  import { Button } from "$lib/components/primitives/ui/button";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    config: AdvancedConfig | null;
    allowedRegistries: string[];
    requiredPaths: string[];
  }

  let { config, allowedRegistries, requiredPaths }: Props = $props();

  const textareaClassName = `${inputClassName} min-h-20 resize-y font-mono`;
  const refInputClassName = `${inputClassName} font-mono`;

  const initial = untrack(() => config);
  let runImageRef = $state(initial?.run.imageRef ?? "");
  let gradeImageRef = $state(initial?.grade.imageRef ?? "");
  let networkMode = $state<"none" | "allowlist" | "service">(initial?.network.mode ?? "none");
  let allowlistText = $state((initial?.network.allowlist ?? []).join("\n"));
  let serviceImageRef = $state(initial?.network.service?.imageRef ?? "");
  let maxScore = $state(initial?.maxScore ?? 100);
  let requiredPathsText = $state(untrack(() => requiredPaths).join("\n"));
  let saving = $state(false);

  const DIGEST_PATTERN = /^\S+@sha256:[0-9a-f]{64}$/;

  function refIssue(ref: string): string | null {
    const trimmed = ref.trim();
    if (trimmed === "") return null;
    if (!DIGEST_PATTERN.test(trimmed)) return m.advancedImages_digestHint();
    const host = trimmed.slice(0, trimmed.indexOf("@")).split("/")[0] ?? "";
    if (!allowedRegistries.includes(host)) {
      return m.advancedImages_registryHint({ registries: allowedRegistries.join(", ") });
    }
    return null;
  }

  let runIssue = $derived(refIssue(runImageRef));
  let gradeIssue = $derived(refIssue(gradeImageRef));
  let serviceIssue = $derived(networkMode === "service" ? refIssue(serviceImageRef) : null);

  let canSave = $derived(
    runImageRef.trim() !== "" &&
      gradeImageRef.trim() !== "" &&
      runIssue === null &&
      gradeIssue === null &&
      (networkMode !== "service" || (serviceImageRef.trim() !== "" && serviceIssue === null)) &&
      (networkMode !== "allowlist" || allowlistText.trim() !== ""),
  );

  async function save() {
    saving = true;
    const payload = {
      runImageRef: runImageRef.trim(),
      gradeImageRef: gradeImageRef.trim(),
      networkMode,
      networkAllowlist:
        networkMode === "allowlist"
          ? allowlistText
              .split("\n")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
          : [],
      ...(networkMode === "service" ? { serviceImageRef: serviceImageRef.trim() } : {}),
      maxScore,
      requiredPaths: requiredPathsText
        .split("\n")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    };
    const fd = new FormData();
    fd.set("data", JSON.stringify(payload));
    try {
      const res = await fetch("?/updateAdvancedConfig", { method: "POST", body: fd });
      const result = deserialize(await res.text());
      if (result.type === "success") {
        toasts.success(m.advancedImages_saveSuccess());
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
      saving = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="space-y-1">
    <h2 class="text-title-sm font-semibold">{m.advancedImages_title()}</h2>
    <p class="text-body-sm text-muted-foreground">{m.advancedImages_intro()}</p>
    <p class="text-caption text-muted-foreground">
      {m.advancedImages_registryHint({ registries: allowedRegistries.join(", ") })}
    </p>
  </div>

  <label class="block text-body-sm text-muted-foreground">
    <span>{m.advancedImages_runLabel()}</span>
    <input
      class={refInputClassName}
      placeholder="ghcr.io/your-org/your-run-image@sha256:…"
      bind:value={runImageRef}
    />
    {#if runIssue}<span class="text-caption text-destructive">{runIssue}</span>{/if}
  </label>

  <label class="block text-body-sm text-muted-foreground">
    <span>{m.advancedImages_gradeLabel()}</span>
    <input
      class={refInputClassName}
      placeholder="ghcr.io/your-org/your-grade-image@sha256:…"
      bind:value={gradeImageRef}
    />
    {#if gradeIssue}<span class="text-caption text-destructive">{gradeIssue}</span>{/if}
  </label>

  <div class="grid gap-4 md:grid-cols-2">
    <label class="block text-body-sm text-muted-foreground">
      <span>{m.advancedImages_networkLabel()}</span>
      <select
        class="mt-1 h-9 w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body-sm text-foreground"
        bind:value={networkMode}
      >
        <option value="none">{m.advancedImages_networkNone()}</option>
        <option value="allowlist">{m.advancedImages_networkAllowlist()}</option>
        <option value="service">{m.advancedImages_networkService()}</option>
      </select>
    </label>

    <label class="block text-body-sm text-muted-foreground">
      <span>{m.advancedImages_maxScoreLabel()}</span>
      <input class={inputClassName} type="number" min="1" max="100000" bind:value={maxScore} />
    </label>
  </div>

  {#if networkMode === "allowlist"}
    <label class="block text-body-sm text-muted-foreground">
      <span>{m.advancedImages_allowlistLabel()}</span>
      <textarea
        class={textareaClassName}
        placeholder={"api.example.com\ncdn.example.com"}
        bind:value={allowlistText}></textarea>
      <span class="text-caption">{m.advancedImages_allowlistHint()}</span>
    </label>
  {/if}

  {#if networkMode === "service"}
    <label class="block text-body-sm text-muted-foreground">
      <span>{m.advancedImages_serviceLabel()}</span>
      <input
        class={refInputClassName}
        placeholder="ghcr.io/your-org/your-service-image@sha256:…"
        bind:value={serviceImageRef}
      />
      {#if serviceIssue}<span class="text-caption text-destructive">{serviceIssue}</span>{/if}
    </label>
  {/if}

  <label class="block text-body-sm text-muted-foreground">
    <span>{m.advancedImages_requiredPathsLabel()}</span>
    <textarea
      class={textareaClassName}
      placeholder={"main.py\nsolver/model.py"}
      bind:value={requiredPathsText}></textarea>
    <span class="text-caption">{m.advancedImages_requiredPathsHint()}</span>
  </label>

  <div class="flex items-center gap-3">
    <Button size="sm" loading={saving} disabled={!canSave || saving} onclick={save}>
      {saving ? m.common_saving() : m.advancedImages_save()}
    </Button>
    <p class="text-caption text-muted-foreground">{m.advancedImages_testReminder()}</p>
  </div>
</div>
