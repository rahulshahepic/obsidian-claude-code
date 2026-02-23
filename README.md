# claude-code-web

A self-hosted web app (PWA) that lets you run [Claude Code](https://github.com/anthropics/claude-code) from any browser — including your phone. You deploy it on your own VPS. No accounts, no multi-tenancy — just you and your server.

**What it does:** You open a chat in your browser, talk to Claude Code, and it executes tasks inside a sandboxed Docker container on your server — reading and editing files, running commands, and writing code. Works as a PWA on iOS/Android so it feels like a native app.

**What it requires:** A Claude Pro or Max subscription. Authentication is done via your Claude account's OAuth — no API keys needed.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser (desktop or mobile)                             │
│  Chrome / Safari / installed PWA                         │
│  Chat UI · Settings · Monitor                            │
└──────────────────────┬───────────────────────────────────┘
                       │ WebSocket + HTTPS
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Your VPS (Ubuntu 24.04)                                 │
│                                                          │
│  Caddy (port 443, auto-HTTPS)                            │
│    └─▶ SvelteKit app (port 3000)                         │
│          Pages: /  /setup  /login  /settings  /monitor   │
│          API:   /api/auth/*  /api/setup/*  /api/session  │
│          WS:    ws:// upgrade for chat                   │
│                        │                                 │
│          Session Manager (in-process Node.js)            │
│            ┌ calls @anthropic-ai/claude-agent-sdk        │
│            ├ pathToClaudeCodeExecutable → docker-exec.sh │
│            ├ canUseTool → WS permission round-trip       │
│            └ streams SDK messages → WebSocket clients    │
│                        │ docker exec -i                  │
│          Workspace Container (Docker)                    │
│            ubuntu:24.04, Node LTS, Claude CLI            │
│            memory: 1 GB  cpus: 1.0  pids: 200            │
│                                                          │
│  SQLite  ./data/app.db                                   │
│    config: encrypted tokens, OAuth state                 │
│    sessions: history, cost, turn counts                  │
└──────────────────────────────────────────────────────────┘
```

### Key design decisions

**Mobile-first, no desktop assumed.** This project is developed, supported, and used entirely from a mobile browser. There is no desktop app, no SSH access assumed, and no terminal fallback. Every feature — including debugging and observability — must work from the phone. If you can't do it from the browser UI, it doesn't exist.

**Single-user.** One instance per person. The entire auth stack is built around a single allowed email. No admin panel, no user table, no per-user isolation complexity.

**Google OAuth for browser login.** Only the email in `ALLOWED_EMAIL` can sign in. After the OAuth callback verifies the email, a 30-day HMAC-signed session cookie is issued. No passwords, no passkeys.

**Claude account via OAuth (not an API key).** During setup you sign in with your own Claude account using the same PKCE flow the Claude CLI uses. This means you use your Claude Pro or Max subscription — not pay-per-token API billing. Your credentials are encrypted and stored locally on your server.

**Docker isolation.** The Claude Code CLI runs inside a persistent workspace container. The host-side SDK bridges to it via `docker exec -i`. This keeps Bash tool execution sandboxed away from the host OS.

**WebSocket chat.** One persistent WS connection per browser tab. The session manager broadcasts to all connected clients (useful if you have the chat open on phone and laptop simultaneously). Permission prompts pause the SDK and wait for an approve/deny from any connected client.

**In-browser observability.** Since there is no SSH access, all server diagnostics are exposed in the UI. A debug panel in the chat header shows interleaved client and server logs in real time — WebSocket lifecycle events, auth validation, token status, session state transitions. Server logs are kept in a 200-entry ring buffer and served via `/api/debug`.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend + API | SvelteKit + adapter-node |
| Styling | Tailwind CSS v4 |
| Browser auth | Google OAuth 2.0 (single allowed email) |
| Claude auth | claude.ai OAuth PKCE (your own account) |
| Claude SDK | `@anthropic-ai/claude-agent-sdk` |
| Tool isolation | Docker workspace container |
| Database | SQLite via Drizzle ORM |
| Reverse proxy | Caddy (auto-HTTPS) |

---

## VPS setup

### Prerequisites

- Ubuntu 24.04 VPS (1 GB RAM minimum, 2 GB recommended)
- Docker + Docker Compose installed
- A domain with an A record pointing to the VPS
- A Google Cloud project with an OAuth 2.0 web client
- A Claude Pro or Max subscription

### 1. Google OAuth client

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** → Application type: **Web application**
3. Add an authorized redirect URI:
   ```
   https://YOUR_DOMAIN/api/auth/callback
   ```
4. Copy the **Client ID** and **Client Secret**

### 2. First-time server setup

SSH into the VPS, clone the repo, and run the setup script:

```bash
git clone https://github.com/YOUR_USER/claude-code-web.git ~/claude-code-web
cd ~/claude-code-web
bash scripts/setup.sh
```

The script prompts for your domain, Google OAuth credentials, and your email address, then generates a `.env` with those values plus random secrets for session signing and encryption.

Start everything:

```bash
docker compose up -d --build
```

### 3. First-time app setup (in your browser)

Open `https://YOUR_DOMAIN`. You'll be directed to a one-step setup wizard:

**Authenticate with Claude** — click "Sign in with Claude →", complete the OAuth flow in your browser, then paste the authorization code shown on Anthropic's callback page back into the wizard. Alternatively, use the "Paste token" tab: run `claude setup-token` on a machine where you're already logged into Claude Code and paste the result.

After authenticating, you'll land on the chat page and Claude Code is ready to use.

---

## User guide

### Starting a conversation

Type your request in the chat box and press Send (or Enter on desktop). Claude Code will start working immediately — you'll see its responses stream in, along with any tools it uses.

**Example prompts:**
- "List the files in the current directory"
- "Write a Python script that fetches the current weather for a given city"
- "Find all TODO comments in the project and summarise them"

### Tool calls and permission prompts

Claude Code has access to tools like Bash, file read/write, and web search. For sensitive operations, it will pause and ask your permission before proceeding.

When a permission prompt appears:
- **Allow** — Claude proceeds with the tool call
- **Deny** — Claude is told the action was denied and will try a different approach

Unanswered permission prompts time out after 5 minutes (denied automatically).

If you have the app open on multiple devices simultaneously (phone + laptop), the permission prompt appears on all of them — approving or denying from any one resolves it for all.

### Interrupting a session

Hit the **Stop** button (visible while a session is running) to interrupt Claude mid-task. Claude will stop at the next safe point. You can start a new request immediately after.

### Sending follow-up messages

After Claude responds, just type your next message. If the session is still running (Claude is working), your message is queued and delivered as the next turn. If the session has finished, a new session starts automatically.

### Debug panel

Tap **debug** in the top-right corner of the chat header to toggle the debug panel. It shows a live log of everything happening under the hood:

- **WebSocket lifecycle** — connection attempts, open/close events with close codes, reconnect backoff timing
- **Auth validation** — whether cookies are present on WebSocket upgrade, HMAC validation results, 401 rejections
- **OAuth tokens** — load/decrypt results, expiry status, refresh attempts and outcomes
- **Session state** — state transitions (idle → running → done), broadcast delivery, SDK errors
- **Route guards** — SvelteKit hook redirects (login, setup)

Log entries are color-coded: **yellow** for client-side events, **cyan** for server-side events. The panel polls server logs every 2 seconds when open. Use the **Clear** button to reset and **Refresh** to pull the latest.

This is the primary tool for diagnosing connection issues, auth failures, and token problems — no SSH required.

### Managing your Claude token

Your Claude OAuth token expires periodically. When it does:
- The chat will show an error when you try to start a session
- The `/monitor` page will flag the token as expired
- Go to **Settings** → "Update token →" and paste a fresh token from `claude setup-token`

The token is refreshed automatically when possible. The Settings page shows the current expiry time.

### Monitoring usage and cost

The `/monitor` page (accessible from the nav) shows:
- **System** — CPU, RAM, and disk usage on the host
- **Container** — workspace container status and uptime
- **Claude Auth** — token validity and time until expiry
- **Usage** — session count and API cost for the last 30 days and all time

> Note: if you're using a Claude Pro or Max subscription via OAuth, "API cost" reflects the compute used against your subscription, not direct billing. The numbers are still useful for understanding relative usage.

### PWA installation

On mobile, you can install the app to your home screen for a full-screen, app-like experience:
- **iOS (Safari):** Share → Add to Home Screen
- **Android (Chrome):** Menu → Add to Home screen, or tap the install prompt

The PWA caches the app shell for fast loading and works offline (though Claude obviously requires an internet connection).

---

## Local development

```bash
cd app
npm install
cp .env.example .env   # fill in APP_SECRET, ENCRYPTION_KEY, DATABASE_URL
npm run dev
```

The app starts at `http://localhost:5173`. On first visit it redirects to `/setup`.

> You can skip Google OAuth locally by setting `BYPASS_AUTH=true` in `.env` — the setup wizard will still work but login is skipped.

Run tests:

```bash
npm test                # unit tests (vitest)
npm run test:coverage   # with coverage report
npm run test:e2e        # Playwright end-to-end
```

Coverage thresholds (enforced in CI): statements ≥ 80%, branches ≥ 75%, functions ≥ 80%.

---

## CI/CD (GitHub Actions)

Pushing to `main` triggers a deploy. Set these secrets in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USER` | SSH username (e.g. `ubuntu`) |
| `VPS_SSH_KEY` | Private SSH key (PEM format) |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `ALLOWED_EMAIL` | Your Google account email |

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_EMAIL` are injected into the server's `.env` on every deploy and override whatever `setup.sh` wrote.

If `VPS_HOST` is not set the deploy step is skipped (useful for forks or dev environments).

### Manual deploy

```bash
ssh user@your-vps
cd ~/claude-code-web
bash scripts/deploy.sh
```

---

## Expected cost

### Claude usage

Claude Code using your Pro or Max subscription:

| Usage pattern | Approximate impact |
|---|---|
| Light (a few quick tasks/day) | Minimal — well within typical subscription limits |
| Moderate (30–60 min active use/day) | May approach subscription limits on heavy tool-use tasks |
| Heavy (hours of active coding/day) | Likely to hit limits; consider usage patterns |

Actual consumption depends on context window size and tool call frequency. The `/monitor` page tracks your 30-day session history and estimated cost.

### VPS

A 1 GB RAM VPS (Hetzner CX22, DigitalOcean Basic, Vultr) runs ~$4–7/month. The workspace container uses about 200–400 MB RAM at idle. 2 GB is comfortable for parallel tool use.

---

## Project structure

```
claude-code-web/
├── .env.example
├── .github/workflows/ci.yml       vitest + coverage gate on every PR
├── docker-compose.yml             caddy + app + workspace services
├── Caddyfile                      HTTPS reverse proxy config
├── scripts/
│   ├── setup.sh                   interactive first-time VPS setup
│   └── deploy.sh                  git pull → rebuild → restart
├── container/
│   ├── Dockerfile                 ubuntu:24.04, Node LTS, Claude CLI
│   └── docker-exec-wrapper.sh    pathToClaudeCodeExecutable bridge
└── app/
    ├── src/
    │   ├── server.ts              custom prod entry (HTTP + WS on same port)
    │   ├── hooks.server.ts        setup + auth route guards
    │   ├── service-worker.ts      PWA offline cache
    │   ├── lib/server/
    │   │   ├── crypto.ts          AES-256-GCM encrypt/decrypt
    │   │   ├── debug-logger.ts    in-app observability (ring buffer + stdout)
    │   │   ├── monitor.ts         health + usage snapshots
    │   │   ├── docker.ts          container lifecycle
    │   │   ├── session-manager.ts SDK loop, canUseTool bridge, WS broadcast
    │   │   ├── ws-handler.ts      per-connection message routing
    │   │   ├── ws-server.ts       HTTP upgrade + session auth
    │   │   ├── db/                Drizzle schema + getConfig/setConfig
    │   │   ├── auth/              Google OAuth + HMAC session cookie
    │   │   └── claude/            PKCE, token refresh, encrypted storage
    │   ├── lib/ws-protocol.ts     WsServerMsg / WsClientMsg types
    │   └── routes/                SvelteKit pages + API handlers
    │       └── api/debug/         GET/DELETE server log ring buffer
    └── e2e/                       Playwright tests
```

---

## Future: multiple users

The app is intentionally single-user. Supporting multiple users would require:

- **User table** in SQLite with per-user Claude credentials and session history
- **Per-user Docker containers** (or per-session containers) to isolate file system access — currently all sessions share one workspace container
- **Multi-user login flow** — currently a single `ALLOWED_EMAIL` gates access; you'd replace this with a user table lookup after the Google OAuth callback
- **Resource accounting** — cost and usage tracking per user rather than per instance
- **Admin UI** — to add/remove users and view per-user usage

None of this is architecturally blocked — the schema and auth layer are the main things to extend.
