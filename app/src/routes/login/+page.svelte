<script lang="ts">
	import { startAuthentication } from '@simplewebauthn/browser';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let status = $state<'idle' | 'waiting' | 'success' | 'error'>('idle');
	let errorMessage = $state('');

	async function login() {
		status = 'waiting';
		errorMessage = '';
		try {
			// 1. Fetch challenge from server
			const optRes = await fetch('/api/auth/login');
			if (!optRes.ok) throw new Error(await optRes.text());
			const options = await optRes.json();

			// 2. Prompt biometric / passkey on device
			const credential = await startAuthentication({ optionsJSON: options });

			// 3. Verify with server
			const verRes = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(credential)
			});
			if (!verRes.ok) throw new Error(await verRes.text());

			status = 'success';
			const returnTo = $page.url.searchParams.get('return_to') ?? '/';
			goto(decodeURIComponent(returnTo));
		} catch (err) {
			status = 'error';
			errorMessage = err instanceof Error ? err.message : 'Authentication failed';
		}
	}
</script>

<svelte:head>
	<title>Sign In — Claude Code</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mb-4 text-5xl">🔐</div>
			<h1 class="text-2xl font-bold text-slate-100">Claude Code</h1>
			<p class="mt-1 text-sm text-slate-400">Sign in with your passkey</p>
		</div>

		<button
			onclick={login}
			disabled={status === 'waiting' || status === 'success'}
			class="w-full rounded-2xl bg-violet-600 px-6 py-4 text-base font-semibold text-white
                   transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{#if status === 'waiting'}
				<span class="flex items-center justify-center gap-2">
					<span class="animate-spin">⟳</span> Waiting for passkey…
				</span>
			{:else if status === 'success'}
				✓ Signed in
			{:else}
				Use Passkey
			{/if}
		</button>

		{#if status === 'error'}
			<p class="mt-4 rounded-xl bg-rose-950 px-4 py-3 text-sm text-rose-300">{errorMessage}</p>
		{/if}

		<p class="mt-6 text-center text-xs text-slate-600">
			Biometric authentication via Face ID, Touch ID, or hardware key.
		</p>
	</div>
</div>
