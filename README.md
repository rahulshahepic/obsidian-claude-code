# obsidian-claude-code

A self-hosted web UI for running [Claude Code](https://github.com/anthropics/claude-code) in your browser, backed by an Obsidian vault. Single-user, authenticated via Google OAuth, deployed with Docker + Caddy.

## Prerequisites

- A Linux VPS with Docker installed
- A domain name with an A record pointing to the VPS
- A Google Cloud project with an OAuth 2.0 web client
- An Anthropic API key

---

## Google OAuth setup

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** → Application type: **Web application**
3. Under **Authorized redirect URIs**, add:
   ```
   https://YOUR_DOMAIN/api/auth/callback
   ```
   (Replace `YOUR_DOMAIN` with your actual domain, e.g. `claude.example.com`)
4. Copy the **Client ID** and **Client Secret** — you'll need them below

---

## First-time server setup

SSH into your VPS, clone the repo, and run the setup script:

```bash
git clone https://github.com/YOUR_USER/obsidian-claude-code.git ~/obsidian-claude-code
cd ~/obsidian-claude-code
bash scripts/setup.sh
```

The script prompts for:
- Your domain (e.g. `claude.example.com`)
- Google Client ID and Client Secret (from above)
- Your Google email address (the only account allowed to log in)

It generates a `.env` file with those values plus random secrets for session signing and encryption.

Then start the app:

```bash
docker compose up -d --build
```

Open `https://YOUR_DOMAIN` and complete the two-step wizard (Anthropic API key + vault path).

---

## GitHub Secrets (for CI/CD auto-deploy)

Pushing to `main` triggers a deploy via GitHub Actions. Set these secrets in your repo's **Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `VPS_HOST` | VPS IP address or hostname |
| `VPS_USER` | SSH username (e.g. `ubuntu`) |
| `VPS_SSH_KEY` | Private SSH key for that user (PEM format) |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `ALLOWED_EMAIL` | Your Google account email |

> **Note:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_EMAIL` are injected into the server's `.env` on every deploy. They don't need to match the values entered during `setup.sh` — the deploy will overwrite them.

If `VPS_HOST` is not set, the deploy step is skipped (useful for forks/dev).

---

## Manual deploy

To deploy without CI, SSH into the VPS and run:

```bash
cd ~/obsidian-claude-code
bash scripts/deploy.sh
```

---

## Checking health / debugging

The health endpoint is unauthenticated and returns JSON — useful for checking status from a phone without SSH:

```
https://YOUR_DOMAIN/api/health
```

If the app fails to start, run `docker compose logs app` on the VPS. Missing required env vars are logged explicitly at startup.

---

## Local development

```bash
cd app
npm install
cp .env.example .env  # fill in values
npm run dev
```

Run tests:

```bash
npm run test          # unit tests
npm run test:e2e      # Playwright end-to-end
npm run test:coverage # unit tests with coverage report
```
