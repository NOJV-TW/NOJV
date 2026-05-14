<script lang="ts" module>
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils/css.js";
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button.svelte";

	export type LinkButtonProps = WithElementRef<HTMLAnchorAttributes, HTMLAnchorElement> & {
		/** Destination URL — required for link-styled buttons. */
		href: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		disabled?: boolean;
		children: Snippet;
	};
</script>

<script lang="ts">
	let {
		class: className,
		href,
		variant = "link",
		size = "default",
		disabled = false,
		ref = $bindable(null),
		children,
		...restProps
	}: LinkButtonProps = $props();
</script>

<a
	bind:this={ref}
	data-slot="link-button"
	class={cn(buttonVariants({ variant, size }), className)}
	href={disabled ? undefined : href}
	aria-disabled={disabled ? "true" : undefined}
	role={disabled ? "link" : undefined}
	tabindex={disabled ? -1 : undefined}
	{...restProps}
>
	{@render children()}
</a>
