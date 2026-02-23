<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	// Pages that don't show the bottom nav
	const noNav = ['/setup', '/login'];
	const showNav = $derived(!noNav.some((p) => $page.url.pathname.startsWith(p)));

	const navItems = [
		{ href: '/', label: 'Chat', icon: '💬' },
		{ href: '/monitor', label: 'Monitor', icon: '📊' },
		{ href: '/settings', label: 'Settings', icon: '⚙️' }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

{#if showNav}
	<nav
		class="fixed bottom-0 left-0 right-0 flex bg-slate-900 border-t border-slate-800"
		style="padding-bottom: env(safe-area-inset-bottom, 0px)"
	>
		{#each navItems as item}
			<a
				href={item.href}
				data-sveltekit-reload
				class="flex flex-1 flex-col items-center gap-0.5 py-3 text-xs transition
                       {$page.url.pathname === item.href
					? 'text-violet-400'
					: 'text-slate-500 active:text-slate-300'}"
			>
				<span class="text-xl leading-none">{item.icon}</span>
				{item.label}
			</a>
		{/each}

		<!-- Sign out — POST so the server can delete the cookie -->
		<form method="POST" action="/api/auth/signout" class="flex flex-1">
			<button
				type="submit"
				class="flex flex-1 flex-col items-center gap-0.5 py-3 text-xs
                       text-slate-500 active:text-slate-300 transition"
			>
				<span class="text-xl leading-none">🔓</span>
				Sign out
			</button>
		</form>
	</nav>
{/if}
