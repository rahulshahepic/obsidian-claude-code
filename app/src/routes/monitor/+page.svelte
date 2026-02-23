<script lang="ts">
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import type { MonitorSnapshot } from '$lib/server/monitor.js';

	let { data }: { data: PageData } = $props();
	// Use a derived so the initial value tracks server-side data reactively,
	// then swap to live-refreshed data once available.
	let liveSnap = $state<MonitorSnapshot | null>(null);
	const snap = $derived<MonitorSnapshot>(liveSnap ?? data.snapshot);

	// Auto-refresh every 30 s
	$effect(() => {
		const id = setInterval(async () => {
			const res = await fetch('/api/monitor');
			if (res.ok) liveSnap = await res.json();
		}, 30_000);
		return () => clearInterval(id);
	});

	function fmtUptime(s: number) {
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	function fmtExpiry(s?: number) {
		if (s === undefined) return '—';
		if (s <= 0) return 'Expired';
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	function statusColor(s: string) {
		return s === 'running' || s === 'ok' ? 'text-emerald-400' : 'text-rose-400';
	}

	function fmtTs(ms: number) {
		return new Date(ms).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	let expandedIdx = $state<number | null>(null);

	// ---------------------------------------------------------------------------
	// Debug logs (server-side)
	// ---------------------------------------------------------------------------

	interface DebugEntry {
		ts: string;
		tag: string;
		msg: string;
		data?: Record<string, unknown>;
	}

	let showDebug = $state(false);
	let debugEntries = $state<DebugEntry[]>([]);
	let debugLogEl = $state<HTMLDivElement | null>(null);
	let debugPollHandle: ReturnType<typeof setInterval> | null = null;

	async function fetchDebugLogs() {
		try {
			const res = await fetch('/api/debug');
			if (!res.ok) return;
			const d = await res.json();
			debugEntries = (d.entries ?? []) as DebugEntry[];
			queueMicrotask(() => {
				if (debugLogEl) debugLogEl.scrollTop = debugLogEl.scrollHeight;
			});
		} catch { /* ignore */ }
	}

	async function clearDebugLogs() {
		try {
			await fetch('/api/debug', { method: 'DELETE' });
			debugEntries = [];
		} catch { /* ignore */ }
	}

	$effect(() => {
		if (!browser) return;
		if (showDebug) {
			fetchDebugLogs();
			debugPollHandle = setInterval(fetchDebugLogs, 3000);
		} else {
			if (debugPollHandle) {
				clearInterval(debugPollHandle);
				debugPollHandle = null;
			}
		}
		return () => {
			if (debugPollHandle) {
				clearInterval(debugPollHandle);
				debugPollHandle = null;
			}
		};
	});

	function fmtDebugEntry(e: DebugEntry): string {
		const time = e.ts.split('T')[1]?.slice(0, 12) ?? e.ts;
		const dataStr = e.data ? ' ' + JSON.stringify(e.data) : '';
		return `${time} [${e.tag}] ${e.msg}${dataStr}`;
	}
</script>

<svelte:head>
	<title>Monitor — Claude Code</title>
</svelte:head>

{#snippet statCard(label: string, value: string, bar: number, sub?: string)}
	<div class="rounded-xl bg-slate-900 px-3 py-3">
		<p class="text-xs text-slate-500">{label}</p>
		<p class="mt-0.5 text-lg font-bold text-slate-100">{value}</p>
		{#if sub}
			<p class="text-xs text-slate-600">{sub}</p>
		{/if}
		<div class="mt-2 h-1 w-full rounded-full bg-slate-800">
			<div
				class="h-1 rounded-full {bar > 85
					? 'bg-rose-500'
					: bar > 60
						? 'bg-amber-500'
						: 'bg-emerald-500'}"
				style="width: {Math.min(bar, 100)}%"
			></div>
		</div>
	</div>
{/snippet}

<div class="min-h-screen bg-slate-950 px-4 py-6" style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 4.5rem)">
	<h1 class="mb-6 text-lg font-semibold text-slate-100">System Monitor</h1>

	<!-- Status banner -->
	<div
		class="mb-4 flex items-center gap-3 rounded-xl px-4 py-3
               {snap.status === 'ok' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}"
	>
		<span class="text-xl">{snap.status === 'ok' ? '✓' : '⚠'}</span>
		<div>
			<p class="font-medium capitalize">{snap.status}</p>
			<p class="text-sm opacity-70">Uptime {fmtUptime(snap.uptimeSeconds)}</p>
		</div>
	</div>

	<!-- System resources -->
	<section class="mb-4">
		<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">System</h2>
		<div class="grid grid-cols-3 gap-2">
			{@render statCard('CPU', `${snap.cpu}%`, snap.cpu)}
			{@render statCard('RAM', `${snap.mem.usedPercent}%`, snap.mem.usedPercent, `${snap.mem.availableMb}MB free`)}
			{@render statCard('Disk', `${snap.disk.usedPercent}%`, snap.disk.usedPercent, `${snap.disk.usedGb}/${snap.disk.totalGb}GB`)}
		</div>
	</section>

	<!-- Container -->
	<section class="mb-4">
		<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Container</h2>
		<div class="rounded-xl bg-slate-900 px-4 py-3">
			<div class="flex items-center justify-between">
				<span class="text-slate-300">claude-workspace</span>
				<span class="font-medium {statusColor(snap.container.status)} capitalize">
					{snap.container.status}
				</span>
			</div>
			{#if snap.container.uptimeSeconds !== undefined}
				<p class="mt-1 text-sm text-slate-500">Up {fmtUptime(snap.container.uptimeSeconds)}</p>
			{/if}
		</div>
	</section>

	<!-- Claude token -->
	<section class="mb-4">
		<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Claude Auth</h2>
		<div class="rounded-xl bg-slate-900 px-4 py-3">
			<div class="flex items-center justify-between">
				<span class="text-slate-300">Token</span>
				<span class="font-medium {snap.claudeTokenValid ? 'text-emerald-400' : 'text-rose-400'}">
					{snap.claudeTokenValid ? 'Valid' : 'Expired'}
				</span>
			</div>
			<p class="mt-1 text-sm text-slate-500">
				Expires in {fmtExpiry(snap.claudeTokenExpiresInSeconds)}
			</p>
			{#if !snap.claudeTokenValid}
				<a
					href="/settings"
					data-sveltekit-reload
					class="mt-2 inline-block rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-medium text-white"
				>
					Re-authenticate →
				</a>
			{/if}
		</div>
	</section>

	<!-- Usage -->
	<section class="mb-4">
		<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
			Usage (30 days)
		</h2>
		<div class="grid grid-cols-2 gap-2">
			<div class="rounded-xl bg-slate-900 px-4 py-3">
				<p class="text-2xl font-bold text-slate-100">{snap.usage.last30DaysSessions}</p>
				<p class="text-sm text-slate-500">Sessions</p>
			</div>
			<div class="rounded-xl bg-slate-900 px-4 py-3">
				<p class="text-2xl font-bold text-slate-100">
					${snap.usage.last30DaysCostUsd.toFixed(2)}
				</p>
				<p class="text-sm text-slate-500">API cost</p>
			</div>
		</div>
		<p class="mt-1 text-xs text-slate-600">
			All time: {snap.usage.totalSessions} sessions · ${snap.usage.totalCostUsd.toFixed(2)}
		</p>
	</section>

	<!-- Recent errors -->
	<section class="mb-4">
		<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
			Recent Errors
			{#if snap.errors.length > 0}
				<span class="ml-1 rounded-full bg-rose-900 px-1.5 py-0.5 text-rose-300">
					{snap.errors.length}
				</span>
			{/if}
		</h2>
		{#if snap.errors.length === 0}
			<div class="rounded-xl bg-slate-900 px-4 py-3">
				<p class="text-sm text-slate-500">No errors since last restart</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each snap.errors as err, i}
					<div class="rounded-xl bg-slate-900 px-4 py-3">
						<button
							class="flex w-full items-start justify-between gap-2 text-left"
							onclick={() => (expandedIdx = expandedIdx === i ? null : i)}
						>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium text-rose-300">{err.message}</p>
								<p class="mt-0.5 text-xs text-slate-500">{fmtTs(err.ts)}</p>
							</div>
							{#if err.stack}
								<span class="mt-0.5 shrink-0 text-xs text-slate-600">
									{expandedIdx === i ? '▲' : '▼'}
								</span>
							{/if}
						</button>
						{#if expandedIdx === i && err.stack}
							<pre class="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-400">{err.stack}</pre>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Debug logs -->
	<section class="mb-4">
		<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
			Debug Logs
		</h2>
		<div class="rounded-xl bg-slate-900 px-4 py-3">
			<div class="flex items-center justify-between">
				<button
					onclick={() => (showDebug = !showDebug)}
					class="text-sm {showDebug ? 'text-amber-400' : 'text-slate-400'}"
				>
					{showDebug ? 'Hide logs' : 'Show server logs'}
				</button>
				{#if showDebug}
					<div class="flex gap-2">
						<button
							onclick={fetchDebugLogs}
							class="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300 active:bg-slate-600"
						>
							Refresh
						</button>
						<button
							onclick={clearDebugLogs}
							class="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300 active:bg-slate-600"
						>
							Clear
						</button>
					</div>
				{/if}
			</div>
			{#if showDebug}
				<div
					bind:this={debugLogEl}
					class="mt-3 max-h-64 overflow-y-auto rounded-lg bg-slate-950 px-3 py-2 font-mono text-[10px] leading-relaxed"
				>
					{#each debugEntries as entry (entry.ts + entry.msg)}
						<div class="whitespace-pre-wrap break-all text-cyan-400 hover:bg-slate-800/50">
							{fmtDebugEntry(entry)}
						</div>
					{/each}
					{#if debugEntries.length === 0}
						<div class="text-slate-500 py-2">No debug entries yet.</div>
					{/if}
				</div>
			{/if}
		</div>
	</section>
</div>
