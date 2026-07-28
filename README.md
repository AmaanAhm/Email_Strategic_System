# Outreach — AI Email Campaign Tool

Personalized B2B email outreach powered by OpenAI and the official Gmail API.

- **Contact verification** — check a sheet (or an existing group) against real mail servers before you send; get your sheet back with the dead rows removed and every column intact
- **Contact groups** — organize contacts into named groups; import CSV / Excel (Name, Company, Email, Website, Industry) per group, each with its own searchable table
- **Multiple senders** — connect several Google accounts and pick which one a campaign sends from (used for the `From` and `Reply-To` headers)
- **One master email** with `{{name}}`, `{{company}}`, `{{industry}}`, `{{website}}` variables
- **AI rewriting** — OpenAI uniquely rewrites every email (subject, greeting, opening, body, CTA, closing) while keeping the meaning and a professional tone
- **Subject variations** — multiple AI-generated subject lines, randomly rotated
- **File attachment** — upload one file (PDF, Word, Excel, CSV, PowerPoint, images, ZIP), attached to every email
- **Safe scheduling** — start date/time, working-hours window, random delays, 100–150/day cap with automatic next-day continuation
- **Dashboard & history** — Total Contacts, Scheduled, Sent, Failed, Remaining; a send calendar with per-day breakdown; sender health; per-recipient campaign status (Queued / Scheduled / Sent / Failed)
- Google OAuth sign-in, light/dark mode, responsive SaaS UI

## Screenshots

### Dashboard

Stats, delivery rate, a send calendar (green dots mark days with sends) with a per-campaign breakdown, upcoming sends, and per-sender health.

![Dashboard](docs/screenshots/dashboard.png)

### Verify your contacts

Upload a `.csv` / `.xlsx` (up to 500 rows) or point it at an existing group. Every
address is checked against its mail server over SMTP — no mail is ever sent, the
conversation stops before `DATA`.

Results split three ways, and the middle one carries the weight:

| Verdict | Meaning |
| --- | --- |
| **Deliverable** | A mail server affirmatively accepted the address |
| **Risky** | Nobody would confirm it — catch-all domain, greylisting, a blocked lookup, a full mailbox. Usually a real person, just unprovable |
| **Undeliverable** | Provably dead — bad syntax, no MX record, or the server said the mailbox does not exist |

Clean and Risky download as separate files, each keeping **every column from your
sheet in the original order**. Known domain typos (`gmail.co` → `gmail.com`) are
repaired and the corrected address is what ships.

![Verify runs](docs/screenshots/verify.png)

![Verification results](docs/screenshots/verify-results.png)

### Contacts — groups and group detail

Contacts are organized into groups; each group has its own import and a searchable table.

![Contact groups](docs/screenshots/contacts-groups.png)

![Contacts inside a group](docs/screenshots/contact-group.png)

### Campaigns

Campaign list, per-campaign detail with recipient-level status, and the campaign builder.

![Campaigns](docs/screenshots/campaigns.png)

![Campaign detail](docs/screenshots/campaign-detail.png)

![New campaign](docs/screenshots/new-campaign.png)

### Senders

Connect multiple Google accounts and choose a default.

![Senders](docs/screenshots/senders.png)

## Stack

Next.js 16 (App Router) · Tailwind CSS v4 · shadcn/ui · PostgreSQL + Prisma 6 · Redis + BullMQ · Auth.js v5 (Google OAuth) · Gmail API (`googleapis`) · OpenAI SDK (GPT-5.5 by default)

## Prerequisites

- Node.js 20.9+
- PostgreSQL 16+ and Redis 7+ — either your own, or `docker compose up -d` (uses [docker-compose.yml](docker-compose.yml))
- A Google Cloud project (for OAuth + Gmail API)
- An OpenAI API key

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
| `OPENAI_API_KEY` | From https://platform.openai.com/api-keys |
| `OPENAI_MODEL` | `gpt-5.5` (default; any chat model your account can reach works) |
| `UPLOAD_DIR` | Where uploaded attachments are stored (default `./uploads`) |
| `APP_URL` | Where the app is served, e.g. `http://localhost:3001`. **The port must match the one `npm run dev` / `npm start` binds** — it is used to build the Google OAuth redirect URIs, and a mismatch causes `Error 400: redirect_uri_mismatch` at sign-in. |

### 2. Google Cloud OAuth (Gmail sending)

1. Create a project at https://console.cloud.google.com
2. **APIs & Services → Library** → enable **Gmail API**
3. **APIs & Services → OAuth consent screen** → External → fill app name/support email → add scope `https://www.googleapis.com/auth/gmail.send` → add your Google account(s) as **Test users** (test mode is fine for internal use)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Web application. Add **both** authorized redirect URIs — the app uses two separate OAuth flows:

   | URI | Used by |
   |---|---|
   | `http://localhost:3001/api/auth/callback/google` | Signing in |
   | `http://localhost:3001/api/senders/connect/callback` | Connecting an extra sending account |

   Also add `http://localhost:3001` under **Authorized JavaScript origins**.

   The host and port must match `APP_URL` exactly — Google compares the redirect URI character for character. Running on a different port than the one registered is what produces `Error 400: redirect_uri_mismatch`.
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
3. **Campaigns → New Campaign** — write the master email with `{{variables}}`, optionally attach a file, pick recipients, set start time, timezone, working hours, delays, and daily limit
4. **Launch** — recipients get precomputed send slots; the worker sends each email at its slot, having OpenAI uniquely rewrite it first (if the AI call fails, the plain variable-substituted email is sent instead — nothing is lost)
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
- Model override: set `OPENAI_MODEL` (e.g. `gpt-5.4-mini` or `gpt-4.1`) to trade quality vs. cost.
