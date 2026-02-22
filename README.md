# obsidian-claude-code

A self-hosted web app (PWA) that runs [Claude Code](https://github.com/anthropics/claude-code) in your mobile browser, with your Obsidian vault synced via Git. You deploy it on your own VPS. No accounts, no multi-tenancy — just you and your server.

**What it does:** You open a chat on your phone, talk to Claude Code, it reads and edits your vault, and the Obsidian app syncs changes automatically via the Obsidian Git plugin.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Phone                                                   │
│  ┌──────────────┐   ┌────────────────────────────────┐  │
│  │ Obsidian App │   │ Chrome/Safari (installed PWA)  │  │
│  │ + Git plugin │   │  Chat UI                       │  │
│  │              │   │  Settings / Monitor            │  │
│  └──────┬───────┘   └──────────────┬─────────────────┘  │
└─────────┼──────────────────────────┼────────────────────┘
          │ git push/pull (SSH)      │ WebSocket + HTTPS
          ▼                          ▼
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
│            ├ canUseTool → WS permission round-trip        │
│            └ streams SDK messages → WebSocket clients    │
│                        │ docker exec -i                  │
│          Workspace Container (Docker)                    │
│            ubuntu:24.04, Node LTS, Claude CLI, uv        │
│            /vault  ← bind-mounted from host              │
│            memory: 1 GB  cpus: 1.0  pids: 200            │
│                                                          │
│  SQLite  ./data/app.db                                   │
│    config: encrypted tokens, vault path, OAuth state     │
│    sessions: history, cost, turn counts                  │
│                                                          │
│  /var/vault/  ← git bare repo (Obsidian pushes here)     │
└──────────────────────────────────────────────────────────┘
```

### Key design decisions

**Single-user.** One instance per person. The entire auth stack is built around a single allowed email. No admin panel, no user table, no per-user isolation complexity.

**Google OAuth for browser login.** Only the email in `ALLOWED_EMAIL` can sign in. After the OAuth callback verifies the email, a 30-day HMAC-signed session cookie is issued. No passwords, no passkeys.

**Claude account via OAuth.** During setup you sign in with your own Claude account (via the same PKCE flow the Claude CLI uses). Your subscription runs on your server — no third party is involved and there is no ToS issue.

**Docker isolation.** The Claude Code CLI runs inside a persistent workspace container. The host-side SDK bridges to it via `docker exec -i`. This keeps Bash tool execution sandboxed away from the host OS.

**SSH vault sync.** Obsidian Git connects over SSH. You paste the Obsidian-generated SSH public key in Settings; the app writes it to `~/.ssh/authorized_keys` in a managed marker block. The vault remote URL is `ssh://user@host/path`.

**WebSocket chat.** One persistent WS connection per browser tab. The session manager broadcasts to all connected clients (useful if you have the chat open on phone and laptop simultaneously). Permission prompts pause the SDK and wait for an approve/deny from any connected client.

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
| Vault sync | Git bare repo + SSH |

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

## VPS setup

### Prerequisites

- Ubuntu 24.04 VPS (1 GB RAM minimum, 2 GB recommended)
- Docker + Docker Compose installed
- A domain with an A record pointing to the VPS
- A Google Cloud project with an OAuth 2.0 web client

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
git clone https://github.com/YOUR_USER/obsidian-claude-code.git ~/obsidian-claude-code
cd ~/obsidian-claude-code
bash scripts/setup.sh
```

The script prompts for your domain, Google OAuth credentials, and your email address, then generates a `.env` with those values plus random secrets for session signing and encryption.

Start everything:

```bash
docker compose up -d --build
```

### 3. First-time app setup (in your browser)

Open `https://YOUR_DOMAIN`. You'll be directed through a two-step wizard:

1. **Authenticate with Claude** — click "Sign in with Claude →", complete the OAuth flow in your browser, then paste the code shown on Anthropic's callback page back into the wizard.
2. **Configure vault** — enter the path on the VPS where your vault should live (e.g. `/var/vault/my-vault`). The app initialises a git bare repo and shows you the SSH URL to add in Obsidian Git.

### 4. Obsidian Git setup (on your phone)

1. Install the **Obsidian Git** community plugin
2. In plugin settings → **SSH** → paste in your SSH public key and copy it
3. Back in the app's Settings page → **SSH key** → paste your public key and save
4. Set the remote URL in Obsidian Git to the SSH URL shown in Settings (format: `ssh://user@host/var/vault/my-vault`)
5. Commit and push from Obsidian to verify the connection

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
cd ~/obsidian-claude-code
bash scripts/deploy.sh
```

---

## Expected cost

### Claude usage

Claude Code with Sonnet 4.5/4.6 via your own account:

| Usage pattern | Approximate cost |
|---|---|
| Light (a few quick tasks/day) | $5–15 / month |
| Moderate (30–60 min active use/day) | $20–60 / month |
| Heavy (hours of active coding/day) | $60–200 / month |

These are rough estimates — actual cost depends entirely on context window size and how many tool calls Claude makes per turn. The `/monitor` page shows your running 30-day total.

> If you have a Claude Pro or Max subscription, you can use it directly without additional API billing. Billing depends on whether you authenticate via subscription OAuth or API key.

### VPS

A 1 GB RAM VPS (Hetzner CX22, DigitalOcean Basic, Vultr) runs ~$4–7/month. The workspace container uses about 200–400 MB RAM at idle. 2 GB is comfortable for parallel tool use.

---

## Monitoring and health

The `/monitor` page (login-gated) shows CPU, RAM, disk, container status, Claude token expiry, vault last push, and 30-day usage totals.

The `/api/health` endpoint is unauthenticated — useful for external uptime monitors:

```
GET https://YOUR_DOMAIN/api/health
```

Returns `200 ok` when the container is running and the Claude token is valid, `503 degraded` otherwise.

---

## Future: multiple users

The app is intentionally single-user. Supporting multiple users would require:

- **User table** in SQLite with per-user Claude credentials, vault paths, and session history
- **Per-user Docker containers** (or per-session containers) to isolate file system access — currently all sessions share one workspace container and one vault mount
- **Per-user SSH keys** in `authorized_keys` with separate vault remotes
- **Multi-user login flow** — currently a single `ALLOWED_EMAIL` gates access; you'd replace this with a user table lookup after the Google OAuth callback
- **Resource accounting** — cost and usage tracking per user rather than per instance
- **Admin UI** — to add/remove users and view per-user usage

None of this is architecturally blocked — the schema and auth layer are the main things to extend. The self-hosted single-user model is simpler for most people and avoids the multi-tenancy complexity entirely.

---

## Project structure

```
obsidian-claude-code/
├── .env.example
├── .github/workflows/ci.yml       vitest + coverage gate on every PR
├── docker-compose.yml             caddy + app + workspace services
├── Caddyfile                      HTTPS reverse proxy config
├── scripts/
│   ├── setup.sh                   interactive first-time VPS setup
│   └── deploy.sh                  git pull → rebuild → restart
├── container/
│   ├── Dockerfile                 ubuntu:24.04, Node LTS, Claude CLI, uv
│   └── docker-exec-wrapper.sh    pathToClaudeCodeExecutable bridge
└── app/
    ├── src/
    │   ├── server.ts              custom prod entry (HTTP + WS on same port)
    │   ├── hooks.server.ts        setup + auth route guards
    │   ├── service-worker.ts      PWA offline cache
    │   ├── lib/server/
    │   │   ├── crypto.ts          AES-256-GCM encrypt/decrypt
    │   │   ├── monitor.ts         health + usage snapshots
    │   │   ├── docker.ts          container lifecycle
    │   │   ├── session-manager.ts SDK loop, canUseTool bridge, WS broadcast
    │   │   ├── ws-handler.ts      per-connection message routing
    │   │   ├── ws-server.ts       HTTP upgrade + session auth
    │   │   ├── git.ts             vault init, SSH URL, authorized_keys
    │   │   ├── db/                Drizzle schema + getConfig/setConfig
    │   │   ├── auth/              Google OAuth + HMAC session cookie
    │   │   └── claude/            PKCE, token refresh, encrypted storage
    │   ├── lib/ws-protocol.ts     WsServerMsg / WsClientMsg types
    │   └── routes/                SvelteKit pages + API handlers
    └── e2e/                       Playwright tests
```
