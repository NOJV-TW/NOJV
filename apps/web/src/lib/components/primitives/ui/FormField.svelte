<script lang="ts" module>
	/**
	 * FormField wraps a form control with label, hint and error plumbing.
	 *
	 * Caller responsibilities:
	 *   1. Pass an `id` to the child input that matches FormField's `for` prop.
	 *   2. Set `aria-invalid={!!error}` on the child when surfacing errors.
	 *   3. Optionally wire `aria-describedby` to the helper/error element id.
	 *
	 * This component intentionally does not auto-focus on error — page-level
	 * code decides focus order after submit.
	 *
	 * Example:
	 *   <FormField label="Email" hint="We never share it" error={form.errors.email} for="email" required>
	 *     <Input id="email" bind:value={form.email} type="email" aria-invalid={!!form.errors.email} />
	 *   </FormField>
	 */
</script>

<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils/css.js";

	interface Props {
		label: string;
		hint?: string;
		error?: string;
		required?: boolean;
		for?: string;
		/**
		 * Visible required marker. Defaults to "*". The marker is rendered
		 * with `aria-hidden` so screen readers do not speak "star"; pair it
		 * with `requiredLabel` for the accessible announcement.
		 */
		requiredMarker?: string;
		/**
		 * Screen-reader-only text announcing the required state.
		 * Pass a localized string from paraglide (e.g. `m.form_required_aria()`).
		 * Defaults to "required".
		 */
		requiredLabel?: string;
		class?: string;
		children: Snippet;
	}

	let {
		label,
		hint,
		error,
		required = false,
		for: htmlFor,
		requiredMarker = "*",
		requiredLabel = "required",
		class: className,
		children,
	}: Props = $props();
</script>

<div class={cn("flex flex-col gap-1.5", className)}>
	<label for={htmlFor} class="text-[length:var(--text-body-sm)] font-medium">
		{label}
		{#if required}
			<span class="text-destructive ml-0.5" aria-hidden="true">{requiredMarker}</span>
			<span class="sr-only">{requiredLabel}</span>
		{/if}
	</label>
	{@render children()}
	{#if error}
		<p class="text-[length:var(--text-caption)] text-destructive" role="alert">{error}</p>
	{:else if hint}
		<p class="text-[length:var(--text-caption)] text-muted-foreground">{hint}</p>
	{/if}
</div>
