import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * Vite dev-server plugin: attach the WebSocket handler to the Vite HTTP server.
 * In production, src/server.ts does the same via attachWebSocketServer().
 *
 * The import is started eagerly inside configureServer (before the HTTP server
 * begins listening) so there is no window where upgrade requests can arrive
 * without a handler.  If the import resolves before the server is listening we
 * attach immediately; otherwise we wait for the 'listening' event.
 */
function wsDevPlugin(): Plugin {
	return {
		name: 'ws-dev',
		configureServer(server) {
			// Begin import immediately — well before the server starts accepting
			// connections — to close the race between the server becoming ready
			// and the upgrade handler being wired up.
			const attachPromise = import('./src/lib/server/ws-server.js').then(
				(m) => m.attachWebSocketServer
			);

			const attach = () => {
				attachPromise.then((attachWebSocketServer) => {
					if (server.httpServer) attachWebSocketServer(server.httpServer);
				});
			};

			if (server.httpServer?.listening) {
				attach();
			} else {
				server.httpServer?.once('listening', attach);
			}
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
