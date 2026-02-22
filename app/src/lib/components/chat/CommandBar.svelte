<script lang="ts">
	let {
		onSend,
		onInterrupt,
		disabled = false,
		sessionState = 'idle'
	}: {
		onSend: (content: string) => void;
		onInterrupt: () => void;
		disabled?: boolean;
		sessionState?: 'idle' | 'running' | 'waiting_permission' | 'error' | 'done';
	} = $props();

	let content = $state('');
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	const isRunning = $derived(sessionState === 'running' || sessionState === 'waiting_permission');
	const isSlashCommand = $derived(content.trimStart().startsWith('/'));
	const canSend = $derived(content.trim().length > 0 && !disabled && !isRunning);

	function resize() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + 'px';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			if (canSend) submit();
		}
	}

	function submit() {
		const text = content.trim();
		if (!text) return;
		onSend(text);
		content = '';
		if (textareaEl) textareaEl.style.height = 'auto';
	}
</script>

<div
	class="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm px-3 pt-2"
	style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem)"
>
	<div class="flex items-end gap-2">
		<!-- Input area -->
		<div class="relative flex-1 rounded-2xl border border-slate-700 bg-slate-900">
			{#if isSlashCommand}
				<div class="absolute left-3 top-2.5 flex items-center">
					<span class="rounded bg-violet-700/50 px-1.5 py-0.5 font-mono text-xs text-violet-300">
						cmd
					</span>
				</div>
			{/if}
			<textarea
				bind:this={textareaEl}
				bind:value={content}
				oninput={resize}
				onkeydown={handleKeydown}
				rows="1"
				placeholder={isRunning ? 'Claude is thinking…' : 'Message Claude…'}
				disabled={disabled || isRunning}
				class="block w-full resize-none rounded-2xl bg-transparent px-4 py-3 text-sm text-slate-100
                       placeholder:text-slate-600 focus:outline-none disabled:opacity-50
                       {isSlashCommand ? 'pl-14' : ''}"
				style="max-height: 160px; overflow-y: auto"
			></textarea>
		</div>

		<!-- Action button: interrupt while running, send otherwise -->
		{#if isRunning}
			<button
				onclick={onInterrupt}
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full
                       bg-rose-600 text-white transition active:scale-90"
				aria-label="Interrupt"
			>
				<span class="text-base leading-none">■</span>
			</button>
		{:else}
			<button
				onclick={submit}
				disabled={!canSend}
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full
                       bg-violet-600 text-white transition active:scale-90
                       disabled:opacity-30 disabled:cursor-not-allowed"
				aria-label="Send"
			>
				<span class="text-base leading-none">↑</span>
			</button>
		{/if}
	</div>
</div>
