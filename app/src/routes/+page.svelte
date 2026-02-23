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

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	let items = $state<ChatItem[]>([]);
	let sessionState = $state<'idle' | 'running' | 'waiting_permission' | 'error' | 'done'>('idle');
	let totalCostUsd = $state(0);
	let pendingPermission = $state<PendingPermission | null>(null);
	let wsStatus = $state<'connecting' | 'connected' | 'disconnected'>('connecting');

	let listEl = $state<HTMLDivElement | null>(null);
	let idCounter = 0;
	function nextId() {
		return String(++idCounter);
	}

	// ---------------------------------------------------------------------------
	// Message handling
	// ---------------------------------------------------------------------------

	function handleMsg(msg: WsServerMsg) {
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

		let destroyed = false;
		let reconnectHandle: ReturnType<typeof setTimeout> | null = null;
		let reconnectDelay = 1000;
		let attempts = 0;

		function connect() {
			if (destroyed) return;
			attempts++;
			wsStatus = 'connecting';

			const ws = new WebSocket(url);
			wsRef = ws;

			ws.onopen = () => {
				if (destroyed) { ws.close(); return; }
				wsStatus = 'connected';
				reconnectDelay = 1000;
			};

			ws.onclose = (event: CloseEvent) => {
				console.log('[ws] close', { code: event.code, reason: event.reason, attempt: attempts });
				if (destroyed) return;
				wsStatus = 'disconnected';
				reconnectHandle = setTimeout(() => {
					reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
					connect();
				}, reconnectDelay);
			};

			ws.onerror = () => {
				console.log('[ws] error', { readyState: ws.readyState, attempt: attempts });
			};

			ws.onmessage = (event: MessageEvent) => {
				try {
					const msg = JSON.parse(event.data as string) as WsServerMsg;
					handleMsg(msg);
				} catch {
					console.warn('[ws] failed to parse message', String(event.data).slice(0, 100));
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

		{#if totalCostUsd > 0}
			<span class="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-xs text-slate-400">
				${totalCostUsd.toFixed(4)}
			</span>
		{/if}
	</header>

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
