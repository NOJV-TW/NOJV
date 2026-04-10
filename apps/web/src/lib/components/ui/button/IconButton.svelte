<script lang="ts" module>
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { buttonVariants, type ButtonVariant } from "./button.svelte";

	export type IconButtonSize = "sm" | "md" | "lg";

	export type IconButtonProps = WithElementRef<HTMLButtonAttributes> & {
		/** Accessible label, used as aria-label (icon-only button has no visible text). */
		label: string;
		variant?: ButtonVariant;
		size?: IconButtonSize;
		loading?: boolean;
		children: Snippet;
	};

	// IconButton sizes map to Button's icon-* sizes.
	// sm (36×36) — dense UI only; md (40×40) — default; lg (44×44) — primary touch targets.
	const sizeMap = {
		sm: "icon-sm",
		md: "icon",
		lg: "icon-lg",
	} as const;
</script>

<script lang="ts">
	import { Loader2 } from "@lucide/svelte";

	let {
		class: className,
		label,
		variant = "ghost",
		size = "md",
		loading = false,
		disabled,
		ref = $bindable(null),
		type = "button",
		children,
		...restProps
	}: IconButtonProps = $props();

	const isDisabled = $derived(disabled || loading);
</script>

<button
	bind:this={ref}
	data-slot="icon-button"
	class={cn(buttonVariants({ variant, size: sizeMap[size] }), className)}
	{type}
	disabled={isDisabled}
	aria-label={label}
	aria-busy={loading ? "true" : undefined}
	{...restProps}
>
	{#if loading}
		<Loader2 class="size-4 animate-spin" aria-hidden="true" />
	{:else}
		{@render children()}
	{/if}
</button>
