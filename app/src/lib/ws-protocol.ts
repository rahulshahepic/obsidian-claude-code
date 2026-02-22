/**
 * WebSocket message protocol shared between server and client.
 *
 * All messages are JSON-encoded strings.
 * Connection requires a valid session cookie (or ?token= query param in dev).
 */

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type WsTextMsg = {
	type: 'text';
	content: string;
};

export type WsToolStartMsg = {
	type: 'tool_start';
	tool: string;
	toolUseId: string;
	input: Record<string, unknown>;
};

export type WsToolEndMsg = {
	type: 'tool_end';
	tool: string;
	toolUseId: string;
	output: string;
};

export type WsPermissionRequestMsg = {
	type: 'permission_request';
	id: string; // toolUseId — echo'd back in permission_response
	tool: string;
	input: Record<string, unknown>;
	description: string;
};

export type WsSessionStateMsg = {
	type: 'session_state';
	state: 'idle' | 'running' | 'waiting_permission' | 'error' | 'done';
};

export type WsCostMsg = {
	type: 'cost';
	totalUsd: number;
};

export type WsErrorMsg = {
	type: 'error';
	message: string;
};

/** Union of all messages the server sends to the client. */
export type WsServerMsg =
	| WsTextMsg
	| WsToolStartMsg
	| WsToolEndMsg
	| WsPermissionRequestMsg
	| WsSessionStateMsg
	| WsCostMsg
	| WsErrorMsg;

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type WsUserMessageMsg = {
	type: 'message';
	content: string;
};

export type WsPermissionResponseMsg = {
	type: 'permission_response';
	id: string;
	allow: boolean;
};

export type WsInterruptMsg = {
	type: 'interrupt';
};

/** Union of all messages the client sends to the server. */
export type WsClientMsg = WsUserMessageMsg | WsPermissionResponseMsg | WsInterruptMsg;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isClientMsg(raw: unknown): raw is WsClientMsg {
	if (typeof raw !== 'object' || raw === null) return false;
	const t = (raw as Record<string, unknown>).type;
	return t === 'message' || t === 'permission_response' || t === 'interrupt';
}
