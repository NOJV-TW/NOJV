<script lang="ts" module>
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils/css.js";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { buttonVariants, type ButtonVariant } from "./button.svelte";

	export type IconButtonSize = "sm" | "md" | "lg";

	export type IconButtonProps = WithElementRef<HTMLButtonAttributes> & {
		label: string;
		variant?: ButtonVariant;
		size?: IconButtonSize;
		loading?: boolean;
		children: Snippet;
	};

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
