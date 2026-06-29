<script lang="ts">
  import { untrack } from "svelte";
  import { Check, UserPlus } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import type { FormMessage } from "$lib/types/form-message";
  import type { SuperValidated } from "sveltekit-superforms";

  type BulkAddForm = {
    handles: string;
    role: "student" | "ta";
  } & Record<string, unknown>;

  interface Props {
    form: SuperValidated<BulkAddForm, FormMessage>;
  }

  let { form: initialForm }: Props = $props();

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting,
  } = superForm<BulkAddForm, FormMessage>(
    untrack(() => initialForm),
    {
      resetForm: true,
      invalidateAll: true,
    },
  );

  const previewHandles = $derived.by(() => {
    const raw = $form.handles ?? "";
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of raw.split(/[\s,;]+/)) {
      const handle = token.trim().toLowerCase();
      if (!handle) continue;
      if (seen.has(handle)) continue;
      seen.add(handle);
      out.push(handle);
    }
    return out;
  });
</script>

<section
  class="animate-in animate-in-1 relative overflow-hidden rounded-xl border border-border-subtle-strong bg-[color:var(--color-panel-strong)] p-5 shadow-rest backdrop-blur-md"
>
  <div
    class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklab,var(--primary)_6%,transparent),transparent_50%)]"
    aria-hidden="true"
  ></div>

  <div class="relative">
    <h2 class="flex items-center gap-2.5 text-title-sm font-medium tracking-[-0.01em]">
      <span class="text-primary" aria-hidden="true">
        <UserPlus aria-hidden="true" class="h-5 w-5" />
      </span>
      {m.members_addTitle()}
    </h2>
    <p class="mt-1.5 text-body-sm text-muted-foreground">
      {m.members_addDescription()}
    </p>

    <form
      method="POST"
      action="?/bulkAdd"
      use:enhance
      class="mt-5 grid gap-5 md:grid-cols-[2fr_1fr]"
    >
      {#if $formMessage?.kind === "error"}
        <div class="md:col-span-2">
          <FormError message={$formMessage.text} />
        </div>
      {/if}
      {#if $formMessage?.kind === "success"}
        <div
          class="rounded-md border border-l-4 border-success/25 border-l-success bg-success/5 px-4 py-3 text-body-sm text-success md:col-span-2"
        >
          {$formMessage.text}
        </div>
      {/if}

      <div>
        <label class="text-body-sm font-medium" for="bulk-handles">
          {m.members_handlesLabel()}
        </label>
        <textarea
          id="bulk-handles"
          name="handles"
          bind:value={$form.handles}
          rows="6"
          class="mt-2 w-full rounded-md border border-border bg-background/80 px-4 py-3 font-mono text-body-sm leading-relaxed focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          placeholder={"b11902001\nb11902024, b11902077\nnewcomer2026"}></textarea>
        {#if $errors.handles}
          <p class="mt-1 text-caption text-destructive">{$errors.handles}</p>
        {/if}

        {#if previewHandles.length > 0}
          <div
            class="mt-3 flex flex-wrap gap-1.5 rounded-md border border-primary/20 bg-primary/5 p-3"
          >
            <span class="mb-1 w-full text-caption font-semibold text-muted-foreground">
              {m.members_previewLabel({ count: previewHandles.length })}
            </span>
            {#each previewHandles as handle (handle)}
              <span
                class="inline-flex items-center rounded-full border border-border bg-[color:var(--color-panel)] px-2.5 py-1 font-mono text-caption text-muted-foreground"
              >
                {handle}
              </span>
            {/each}
          </div>
        {/if}
      </div>

      <div class="space-y-4">
        <fieldset>
          <legend class="text-body-sm font-medium">{m.members_roleLabel()}</legend>
          <div class="mt-2 space-y-2">
            <label
              class="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-[color:var(--color-panel)] px-3.5 py-2.5 transition-colors duration-fast ease-out-soft hover:border-border-strong"
            >
              <input
                type="radio"
                name="role"
                value="student"
                bind:group={$form.role}
                class="size-4 accent-primary"
              />
              <div>
                <div class="text-body-sm font-medium">{m.members_roleStudent()}</div>
                <div class="text-caption text-muted-foreground">
                  {m.members_roleStudentDesc()}
                </div>
              </div>
            </label>
            <label
              class="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-[color:var(--color-panel)] px-3.5 py-2.5 transition-colors duration-fast ease-out-soft hover:border-border-strong"
            >
              <input
                type="radio"
                name="role"
                value="ta"
                bind:group={$form.role}
                class="size-4 accent-primary"
              />
              <div>
                <div class="text-body-sm font-medium">{m.members_roleTa()}</div>
                <div class="text-caption text-muted-foreground">
                  {m.members_roleTaDesc()}
                </div>
              </div>
            </label>
          </div>
        </fieldset>

        <Button
          type="submit"
          class="w-full justify-center"
          disabled={$submitting || previewHandles.length === 0}
        >
          {m.members_confirmAdd({ count: previewHandles.length })}
          <Check class="size-4" aria-hidden="true" />
        </Button>
        <p class="text-center text-caption text-muted-foreground">
          {m.members_hint()}
        </p>
      </div>
    </form>
  </div>
</section>
