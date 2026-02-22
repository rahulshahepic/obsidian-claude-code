import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * Vite dev-server plugin: attach the WebSocket handler to the Vite HTTP server.
 * In production, src/server.ts does the same via attachWebSocketServer().
 */
function wsDevPlugin(): Plugin {
	return {
		name: 'ws-dev',
		configureServer(server) {
			server.httpServer?.once('listening', async () => {
				// Dynamic import avoids bundling the ws module at Vite startup.
				const { attachWebSocketServer } = await import('./src/lib/server/ws-server.js');
				attachWebSocketServer(server.httpServer!);
			});
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), wsDevPlugin()],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['src/test-setup.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/lib/server/**/*.ts', 'src/lib/ws-protocol.ts'],
			exclude: [
				'src/lib/server/db/schema.ts',
				// webauthn.ts requires a real browser + hardware authenticator.
				// It is covered by Playwright e2e tests in Phase 4, not unit tests.
				'src/lib/server/auth/webauthn.ts',
				// ws-server.ts and ws-handler.ts boot real HTTP/WS servers;
				// covered by Playwright e2e in Phase 4.
				'src/lib/server/ws-server.ts',
				'src/lib/server/ws-handler.ts'
			],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80
			},
			reporter: ['text', 'html']
		}
	}
});
