<script lang="ts">
	import { browser } from '$app/environment';
	import Message from '$lib/components/chat/Message.svelte';
	import ToolCallCard from '$lib/components/chat/ToolCallCard.svelte';
	import PermissionPrompt from '$lib/components/chat/PermissionPrompt.svelte';
	import CommandBar from '$lib/components/chat/CommandBar.svelte';
	import type { WsServerMsg } from '$lib/ws-protocol.js';

	// ---------------------------------------------------------------------------
	// Types
	// ---------------------------------------------------------------------------

	type ChatItem =
		| { kind: 'user'; id: string; content: string }
		| { kind: 'assistant_text'; id: string; content: string }
		| { kind: 'tool_call'; id: string; tool: string; input: Record<string, unknown>; output?: string }
		| { kind: 'error'; id: string; message: string };

	type PendingPermission = {
		id: string;
		tool: string;
		input: Record<string, unknown>;
		description: string;
	};

	interface DebugLogEntry {
		ts: string;
		source: 'client' | 'server';
		tag: string;
		msg: string;
		data?: Record<string, unknown>;
	}

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	let items = $state<ChatItem[]>([]);
	let sessionState = $state<'idle' | 'running' | 'waiting_permission' | 'error' | 'done'>('idle');
	let totalCostUsd = $state(0);
	let pendingPermission = $state<PendingPermission | null>(null);
	let wsStatus = $state<'connecting' | 'connected' | 'disconnected'>('connecting');

	let listEl = $state<HTMLDivElement | null>(null);
	let debugLogEl = $state<HTMLDivElement | null>(null);
	let idCounter = 0;
	function nextId() {
		return String(++idCounter);
	}

	// ---------------------------------------------------------------------------
	// Debug logging
	// ---------------------------------------------------------------------------

	let showDebug = $state(false);
	let debugLog = $state<DebugLogEntry[]>([]);
	let wsConnectAttempts = $state(0);
	let lastWsCloseCode = $state<number | null>(null);
	let lastWsCloseReason = $state('');
	let lastWsError = $state('');
	let serverLogPollHandle: ReturnType<typeof setInterval> | null = null;

	function clientDebug(tag: string, msg: string, data?: Record<string, unknown>) {
		const entry: DebugLogEntry = {
			ts: new Date().toISOString(),
			source: 'client',
			tag,
			msg,
			data
		};
		debugLog.push(entry);
		// Keep max 500 entries
		if (debugLog.length > 500) debugLog.splice(0, debugLog.length - 500);
		console.log(`[DEBUG ${entry.ts}] [${tag}] ${msg}`, data ?? '');
		// Auto-scroll debug log
		queueMicrotask(() => {
			if (debugLogEl) debugLogEl.scrollTop = debugLogEl.scrollHeight;
		});
	}

	async function fetchServerLogs() {
		try {
			const res = await fetch('/api/debug');
			if (!res.ok) {
				clientDebug('debug-poll', `server log fetch failed: ${res.status}`);
				return;
			}
			const data = await res.json();
			const entries = (data.entries ?? []) as Array<{
				ts: string;
				tag: string;
				msg: string;
				data?: Record<string, unknown>;
			}>;
			// Merge server entries that aren't already in the log
			const existingServerTs = new Set(
				debugLog.filter(e => e.source === 'server').map(e => e.ts + e.msg)
			);
			let added = 0;
			for (const entry of entries) {
				const key = entry.ts + entry.msg;
				if (!existingServerTs.has(key)) {
					debugLog.push({
						ts: entry.ts,
						source: 'server',
						tag: entry.tag,
						msg: entry.msg,
						data: entry.data
					});
					added++;
				}
			}
			if (added > 0) {
				// Sort by timestamp
				debugLog.sort((a, b) => a.ts.localeCompare(b.ts));
				// Trim
				if (debugLog.length > 500) debugLog.splice(0, debugLog.length - 500);
				queueMicrotask(() => {
					if (debugLogEl) debugLogEl.scrollTop = debugLogEl.scrollHeight;
				});
			}
		} catch (err) {
			// Ignore fetch errors during reconnection
		}
	}

	$effect(() => {
		if (!browser) return;
		if (showDebug) {
			// Start polling server logs
			fetchServerLogs();
			serverLogPollHandle = setInterval(fetchServerLogs, 2000);
		} else {
			if (serverLogPollHandle) {
				clearInterval(serverLogPollHandle);
				serverLogPollHandle = null;
			}
		}
		return () => {
			if (serverLogPollHandle) {
				clearInterval(serverLogPollHandle);
				serverLogPollHandle = null;
			}
		};
	});

	// ---------------------------------------------------------------------------
	// Message handling
	// ---------------------------------------------------------------------------

	function handleMsg(msg: WsServerMsg) {
		clientDebug('ws-msg', `received: ${msg.type}`, msg.type === 'text' ? { contentLength: msg.content.length } : msg as unknown as Record<string, unknown>);

		if (msg.type === 'text') {
			// Append to the last assistant_text item if it exists, otherwise create one
			let appended = false;
			for (let i = items.length - 1; i >= 0; i--) {
				if (items[i].kind === 'assistant_text') {
					(items[i] as { kind: 'assistant_text'; id: string; content: string }).content +=
						msg.content;
					appended = true;
					break;
				}
				// Stop searching past user messages or tool calls
				if (items[i].kind === 'user') break;
			}
			if (!appended) {
				items.push({ kind: 'assistant_text', id: nextId(), content: msg.content });
			}
		} else if (msg.type === 'tool_start') {
			items.push({ kind: 'tool_call', id: msg.toolUseId, tool: msg.tool, input: msg.input });
		} else if (msg.type === 'tool_end') {
			for (const item of items) {
				if (item.kind === 'tool_call' && item.id === msg.toolUseId) {
					(item as { kind: 'tool_call'; id: string; tool: string; input: Record<string, unknown>; output?: string }).output = msg.output;
					break;
				}
			}
		} else if (msg.type === 'permission_request') {
			pendingPermission = {
				id: msg.id,
				tool: msg.tool,
				input: msg.input,
				description: msg.description
			};
		} else if (msg.type === 'session_state') {
			sessionState = msg.state;
			if (msg.state !== 'waiting_permission') {
				pendingPermission = null;
			}
		} else if (msg.type === 'cost') {
			totalCostUsd = msg.totalUsd;
		} else if (msg.type === 'error') {
			items.push({ kind: 'error', id: nextId(), message: msg.message });
		}
	}

	// ---------------------------------------------------------------------------
	// WebSocket connection
	// ---------------------------------------------------------------------------

	let wsRef: WebSocket | null = null;

	$effect(() => {
		if (!browser) return;

		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${proto}://${window.location.host}/api/ws`;

		clientDebug('ws-connect', 'initializing WebSocket connection', {
			url,
			protocol: proto,
			host: window.location.host,
			hasCookies: document.cookie.length > 0,
			cookieLength: document.cookie.length,
			// Note: HttpOnly cookies won't appear in document.cookie
			visibleCookies: document.cookie || '(none visible - HttpOnly cookies are hidden from JS)'
		});

		let destroyed = false;
		let reconnectHandle: ReturnType<typeof setTimeout> | null = null;
		let reconnectDelay = 1000;

		function connect() {
			if (destroyed) return;
			wsConnectAttempts++;
			wsStatus = 'connecting';

			clientDebug('ws-connect', `attempt #${wsConnectAttempts}`, {
				reconnectDelay,
				url
			});

			const ws = new WebSocket(url);
			wsRef = ws;

			ws.onopen = () => {
				if (destroyed) { ws.close(); return; }
				clientDebug('ws-lifecycle', 'WebSocket OPEN', {
					protocol: ws.protocol,
					extensions: ws.extensions,
					attempt: wsConnectAttempts
				});
				wsStatus = 'connected';
				reconnectDelay = 1000;
				lastWsError = '';
			};

			ws.onclose = (event: CloseEvent) => {
				lastWsCloseCode = event.code;
				lastWsCloseReason = event.reason || '(no reason)';
				clientDebug('ws-lifecycle', 'WebSocket CLOSE', {
					code: event.code,
					reason: event.reason || '(empty)',
					wasClean: event.wasClean,
					readyState: ws.readyState,
					attempt: wsConnectAttempts
				});

				if (destroyed) return;
				wsStatus = 'disconnected';
				reconnectHandle = setTimeout(() => {
					reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
					clientDebug('ws-reconnect', 'scheduling reconnect', {
						nextDelay: reconnectDelay
					});
					connect();
				}, reconnectDelay);
			};

			ws.onerror = (event: Event) => {
				// The browser doesn't expose error details in the Event, but we log what we can
				lastWsError = 'WebSocket error (details hidden by browser security)';
				clientDebug('ws-lifecycle', 'WebSocket ERROR', {
					type: event.type,
					// Check if we can get the HTTP status from the close that follows
					readyState: ws.readyState,
					readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState],
					attempt: wsConnectAttempts,
					note: 'Browser hides WebSocket error details. If readyState=CONNECTING, the upgrade was rejected (likely 401). Check server logs.'
				});
			};

			ws.onmessage = (event: MessageEvent) => {
				try {
					const msg = JSON.parse(event.data as string) as WsServerMsg;
					handleMsg(msg);
				} catch {
					clientDebug('ws-msg', 'failed to parse message', {
						dataPreview: String(event.data).slice(0, 100)
					});
				}
			};
		}

		connect();

		return () => {
			destroyed = true;
			if (reconnectHandle) clearTimeout(reconnectHandle);
			wsRef?.close();
			wsRef = null;
		};
	});

	// ---------------------------------------------------------------------------
	// Auto-scroll to bottom when messages change
	// ---------------------------------------------------------------------------

	$effect(() => {
		// Establish reactivity on items array length
		void items.length;
		queueMicrotask(() => {
			if (listEl) listEl.scrollTop = listEl.scrollHeight;
		});
	});

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	function sendMessage(content: string) {
		if (!wsRef || wsRef.readyState !== WebSocket.OPEN) return;
		// Add user message to the list optimistically
		items.push({ kind: 'user', id: nextId(), content });
		wsRef.send(JSON.stringify({ type: 'message', content }));
	}

	function respondToPermission(id: string, allow: boolean) {
		if (!wsRef || wsRef.readyState !== WebSocket.OPEN) return;
		wsRef.send(JSON.stringify({ type: 'permission_response', id, allow }));
		pendingPermission = null;
	}

	function interrupt() {
		if (!wsRef || wsRef.readyState !== WebSocket.OPEN) return;
		wsRef.send(JSON.stringify({ type: 'interrupt' }));
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	const stateLabel = $derived.by(() => {
		if (wsStatus === 'connecting') return 'Connecting…';
		if (wsStatus === 'disconnected') return 'Reconnecting…';
		if (sessionState === 'running') return 'Thinking…';
		if (sessionState === 'waiting_permission') return 'Awaiting permission';
		if (sessionState === 'error') return 'Error';
		if (sessionState === 'done') return 'Done';
		return 'Ready';
	});

	const stateColor = $derived.by(() => {
		if (wsStatus !== 'connected') return 'text-amber-400';
		if (sessionState === 'running') return 'text-violet-400';
		if (sessionState === 'waiting_permission') return 'text-amber-400';
		if (sessionState === 'error') return 'text-rose-400';
		if (sessionState === 'done') return 'text-emerald-400';
		return 'text-slate-500';
	});

	const isActive = $derived(sessionState === 'running' || sessionState === 'waiting_permission');

	function formatDebugEntry(entry: DebugLogEntry): string {
		const time = entry.ts.split('T')[1]?.slice(0, 12) ?? entry.ts;
		const src = entry.source === 'server' ? 'SRV' : 'CLI';
		const dataStr = entry.data ? ' ' + JSON.stringify(entry.data) : '';
		return `${time} [${src}] [${entry.tag}] ${entry.msg}${dataStr}`;
	}

	async function clearServerLogs() {
		try {
			await fetch('/api/debug', { method: 'DELETE' });
		} catch { /* ignore */ }
		debugLog = debugLog.filter(e => e.source === 'client');
	}
</script>

<svelte:head>
	<title>Claude Code</title>
</svelte:head>

<!-- Permission prompt (rendered outside scroll area to avoid z-index issues) -->
{#if pendingPermission}
	<PermissionPrompt
		id={pendingPermission.id}
		tool={pendingPermission.tool}
		input={pendingPermission.input}
		description={pendingPermission.description}
		onRespond={respondToPermission}
	/>
{/if}

<div
	class="flex flex-col bg-slate-950"
	style="height: 100dvh; padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 4.5rem)"
>
	<!-- Header -->
	<header class="flex items-center justify-between border-b border-slate-800 px-4 py-3 shrink-0">
		<div class="flex items-center gap-2">
			{#if sessionState === 'running'}
				<span class="h-2 w-2 rounded-full bg-violet-500 animate-pulse"></span>
			{:else if wsStatus === 'connecting' || wsStatus === 'disconnected'}
				<span class="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
			{:else if sessionState === 'waiting_permission'}
				<span class="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
			{:else if sessionState === 'error'}
				<span class="h-2 w-2 rounded-full bg-rose-500"></span>
			{:else}
				<span class="h-2 w-2 rounded-full bg-slate-700"></span>
			{/if}
			<span class="text-sm {stateColor}">{stateLabel}</span>
		</div>

		<div class="flex items-center gap-2">
			{#if totalCostUsd > 0}
				<span class="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-xs text-slate-400">
					${totalCostUsd.toFixed(4)}
				</span>
			{/if}
			<button
				type="button"
				class="rounded-full px-2.5 py-0.5 font-mono text-xs {showDebug ? 'bg-amber-700 text-amber-100' : 'bg-slate-800 text-slate-400'} hover:bg-slate-700 transition-colors"
				onclick={() => showDebug = !showDebug}
			>
				debug
			</button>
		</div>
	</header>

	<!-- Debug panel -->
	{#if showDebug}
		<div class="border-b border-amber-800 bg-slate-900 shrink-0" style="max-height: 50vh;">
			<!-- Debug status summary -->
			<div class="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-slate-800 text-xs">
				<span class="text-slate-400">WS:
					<span class="{wsStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'} font-semibold">{wsStatus}</span>
				</span>
				<span class="text-slate-400">Attempts: <span class="text-slate-200 font-mono">{wsConnectAttempts}</span></span>
				{#if lastWsCloseCode !== null}
					<span class="text-slate-400">Last close:
						<span class="text-slate-200 font-mono">{lastWsCloseCode}</span>
						<span class="text-slate-500">{lastWsCloseReason}</span>
					</span>
				{/if}
				{#if lastWsError}
					<span class="text-rose-400">{lastWsError}</span>
				{/if}
				<span class="text-slate-400">Session: <span class="text-slate-200">{sessionState}</span></span>
				<button
					type="button"
					class="ml-auto rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-600"
					onclick={clearServerLogs}
				>
					Clear
				</button>
				<button
					type="button"
					class="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-600"
					onclick={fetchServerLogs}
				>
					Refresh
				</button>
			</div>
			<!-- Debug log entries -->
			<div bind:this={debugLogEl} class="overflow-y-auto font-mono text-[10px] leading-relaxed px-2 py-1" style="max-height: calc(50vh - 40px);">
				{#each debugLog as entry (entry.ts + entry.msg + entry.source)}
					<div class="whitespace-pre-wrap break-all {entry.source === 'server' ? 'text-cyan-400' : 'text-yellow-300'} hover:bg-slate-800/50">
						{formatDebugEntry(entry)}
					</div>
				{/each}
				{#if debugLog.length === 0}
					<div class="text-slate-500 py-2">No debug entries yet. Events will appear as they occur.</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Message list -->
	<div bind:this={listEl} class="flex-1 overflow-y-auto py-3">
		{#if items.length === 0}
			<!-- Empty state -->
			<div class="flex flex-col items-center justify-center h-full px-6 text-center gap-3 mt-8">
				<div class="text-4xl">&#9670;</div>
				<p class="text-slate-400 text-sm">What would you like to work on?</p>
			</div>
		{/if}

		{#each items as item (item.id)}
			{#if item.kind === 'user'}
				<Message role="user" content={item.content} />
			{:else if item.kind === 'assistant_text'}
				<Message role="assistant" content={item.content} />
			{:else if item.kind === 'tool_call'}
				<ToolCallCard
					tool={item.tool}
					input={item.input}
					output={item.output}
				/>
			{:else if item.kind === 'error'}
				<div class="mx-4 my-1 rounded-xl bg-rose-950/50 border border-rose-800 px-4 py-3">
					<p class="text-sm text-rose-300">{item.message}</p>
				</div>
			{/if}
		{/each}

		{#if isActive}
			<!-- Streaming indicator -->
			<div class="flex justify-start px-4 py-1">
				<div class="rounded-2xl rounded-bl-sm bg-slate-800 px-4 py-2.5">
					<span class="flex gap-1">
						<span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-bounce" style="animation-delay: 0ms"></span>
						<span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-bounce" style="animation-delay: 150ms"></span>
						<span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-bounce" style="animation-delay: 300ms"></span>
					</span>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Input bar (fixed at bottom) -->
<CommandBar
	onSend={sendMessage}
	onInterrupt={interrupt}
	sessionState={sessionState}
	disabled={wsStatus !== 'connected'}
/>
