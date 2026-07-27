# Outreach — AI Email Campaign Tool

Personalized B2B email outreach powered by Claude and the official Gmail API.

- **Contact groups** — organize contacts into named groups; import CSV / Excel (Name, Company, Email, Website, Industry) per group, each with its own searchable table
- **Multiple senders** — connect several Google accounts and pick which one a campaign sends from (used for the `From` and `Reply-To` headers)
- **One master email** with `{{name}}`, `{{company}}`, `{{industry}}`, `{{website}}` variables
- **AI rewriting** — Claude uniquely rewrites every email (subject, greeting, opening, body, CTA, closing) while keeping the meaning and a professional tone
- **Subject variations** — multiple AI-generated subject lines, randomly rotated
- **PDF attachment** — upload one report, attached to every email
- **Safe scheduling** — start date/time, working-hours window, random delays, 100–150/day cap with automatic next-day continuation
- **Dashboard & history** — Total Contacts, Scheduled, Sent, Failed, Remaining; a send calendar with per-day breakdown; sender health; per-recipient campaign status (Queued / Scheduled / Sent / Failed)
- Google OAuth sign-in, light/dark mode, responsive SaaS UI

## Stack

Next.js 16 (App Router) · Tailwind CSS v4 · shadcn/ui · PostgreSQL + Prisma 6 · Redis + BullMQ · Auth.js v5 (Google OAuth) · Gmail API (`googleapis`) · Anthropic SDK (Claude Opus 4.8 by default)

## Prerequisites

- Node.js 20.9+
- PostgreSQL 16+ and Redis 7+ — either your own, or `docker compose up -d` (uses [docker-compose.yml](docker-compose.yml))
- A Google Cloud project (for OAuth + Gmail API)
- An Anthropic API key

## Setup

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres connection string (docker default: `postgresql://postgres:postgres@localhost:5432/email_outreach`) |
| `REDIS_URL` | `redis://localhost:6379` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | From Google Cloud (step 2) |
| `ANTHROPIC_API_KEY` | From https://platform.claude.com |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` (default; any Claude model ID works) |
| `UPLOAD_DIR` | Where uploaded PDFs are stored (default `./uploads`) |

### 2. Google Cloud OAuth (Gmail sending)

1. Create a project at https://console.cloud.google.com
2. **APIs & Services → Library** → enable **Gmail API**
3. **APIs & Services → OAuth consent screen** → External → fill app name/support email → add scope `https://www.googleapis.com/auth/gmail.send` → add your Google account(s) as **Test users** (test mode is fine for internal use)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Web application → Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Copy the Client ID / Client secret into `.env`

> `gmail.send` is a sensitive scope. In test mode up to 100 test users can sign in without Google verification; refresh tokens for test-mode apps expire after 7 days of inactivity unless the app is published.

### 3. Database

```bash
docker compose up -d          # or point DATABASE_URL at your own Postgres
npx prisma migrate dev
```

### 4. Run

```bash
npm run dev:all               # web (localhost:3000) + background worker
```

Or separately: `npm run dev` (web) and `npm run worker` (sender). **The worker must be running for emails to send.**

## Usage

1. Sign in with Google (grants send-only Gmail permission)
2. **Contacts** → Import CSV/Excel — columns: Name, Company, Email, Website, Industry (header aliases like "Organization" or "URL" are recognized; duplicates are skipped)
3. **Campaigns → New Campaign** — write the master email with `{{variables}}`, optionally attach a PDF, pick recipients, set start time, timezone, working hours, delays, and daily limit
4. **Launch** — recipients get precomputed send slots; the worker sends each email at its slot, having Claude uniquely rewrite it first (if the AI call fails, the plain variable-substituted email is sent instead — nothing is lost)
5. Watch progress on the **Dashboard** and the campaign detail page; pause/resume/cancel any time

## How sending stays safe

- Hard cap of **150/day per campaign** (enforced in the scheduler); overflow automatically continues the next working day
- Random per-email delays within your configured window, only inside working hours (campaign timezone, DST-aware)
- Restart-safe worker: atomic status transitions + idempotent job IDs mean a crashed/restarted worker never double-sends
- If Google revokes access (`invalid_grant`), the campaign auto-pauses and the UI shows a "Reconnect Google" banner

## Commands

| Command | What it does |
|---|---|
| `npm run dev:all` | Web + worker together |
| `npm run worker` | Background sender only (tsx watch) |
| `npm run test` | Vitest (scheduling + template unit tests) |
| `npm run build` | Production build |
| `npm run db:migrate` / `db:studio` | Prisma migrate / data browser |

## Notes

- Emails are sent as the signed-in Google account via `gmail.users.messages.send`; sent mail appears in that account's Sent folder.
- Multiple users can sign in; contacts and campaigns are fully scoped per user.
- Model override: set `ANTHROPIC_MODEL` (e.g. `claude-sonnet-5` or `claude-haiku-4-5`) to trade quality vs. cost.
