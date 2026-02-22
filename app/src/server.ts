/**
 * Custom production server entry point for adapter-node.
 *
 * Instead of running `node build/index.js`, run `node build/server.js`.
 * This file is compiled by the build step alongside the SvelteKit app.
 *
 * It creates a Node HTTP server, attaches the WebSocket handler,
 * then hands all other requests to the SvelteKit handler.
 */
import { createServer } from 'http';
import { handler } from '../build/handler.js';
import { attachWebSocketServer } from './lib/server/ws-server.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const httpServer = createServer(handler);
attachWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
	console.log(`Server running on http://0.0.0.0:${PORT}`);
});
