<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils/css";

  interface Props {
    timeLimitMs: number;
    memoryLimitMb: number;
    envRows: { key: string; value: string }[];
  }

  let {
    timeLimitMs = $bindable(),
    memoryLimitMb = $bindable(),
    envRows = $bindable()
  }: Props = $props();

  function addEnvRow() {
    envRows = [...envRows, { key: "", value: "" }];
  }
  function removeEnvRow(i: number) {
    envRows = envRows.filter((_, idx) => idx !== i);
  }
</script>

<section class="rounded-lg border border-border-subtle p-2">
  <h3 class="text-body-sm font-semibold">{m.admin_runtime()}</h3>
  <div class="mt-3 grid gap-3 md:grid-cols-2">
    <label class="text-caption text-muted-foreground">
      <span>{m.admin_timeLimitMs()}</span>
      <input
        class={inputClassName}
        type="number"
        min="100"
        max="30000"
        bind:value={timeLimitMs}
      />
    </label>
    <label class="text-caption text-muted-foreground">
      <span>{m.admin_memoryLimitMb()}</span>
      <input
        class={inputClassName}
        type="number"
        min="16"
        max="1024"
        bind:value={memoryLimitMb}
      />
    </label>
  </div>

  <div class="mt-4">
    <div class="flex items-center justify-between">
      <span class="text-caption font-semibold text-muted-foreground">{m.admin_envVars()}</span>
      <button
        type="button"
        class="text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
        onclick={addEnvRow}
      >
        {m.admin_envAdd()}
      </button>
    </div>
    {#if envRows.length === 0}
      <p class="mt-2 text-caption text-muted-foreground">{m.admin_envNone()}</p>
    {:else}
      <div class="mt-2 space-y-2">
        {#each envRows as row, i (`env-${String(i)}`)}
          <div class="flex gap-2">
            <input
              class="{inputClassName} flex-1"
              type="text"
              placeholder="KEY"
              bind:value={row.key}
            />
            <input
              class="{inputClassName} flex-1"
              type="text"
              placeholder="value"
              bind:value={row.value}
            />
            <button
              type="button"
              class="rounded border border-border px-2 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-destructive"
              onclick={() => removeEnvRow(i)}
              aria-label={m.admin_envRemove()}
            >
              &times;
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>
