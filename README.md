# Gavel

[![CI](https://github.com/Hereliesviolet/gavel/actions/workflows/ci.yml/badge.svg)](https://github.com/Hereliesviolet/gavel/actions/workflows/ci.yml)

Gavel collects German foreclosure auctions (Zwangsversteigerungen) from court and auction portals every day, has an LLM extract the facts from the appraisals, and ranks the objects that deserve a closer look.

![Gavel: listings for one federal state with filters, category and hearing date per object](docs/screenshots/listings-overview.png)

## Screenshots

The screenshots show generated demo data (fictional places, streets, case numbers and illustrations); no real listing appears in them. The interface is in German.

| Screenshot | Shows |
|---|---|
| ![Listing detail page with gallery, key facts and bid limits](docs/screenshots/listing-detail.png) | Listing detail with gallery, key facts and bid limits (5/10 and 7/10 rule). |
| ![Investor decision memo with bear, base and bull scenarios](docs/screenshots/investment-memo.png) | Investor memo on the detail page: bear/base/bull underwriting and bid curve. |
| ![Fix and flip measures and deal calculation](docs/screenshots/fix-flip-calculation.png) | Fix-and-flip measures with cost ranges and the deal calculation. |
| ![Investor search with strategy filters and ranked candidates](docs/screenshots/investor-search.png) | Investor search: strategy presets, filters and ranked candidates. |
| ![Upcoming auction dates grouped by month](docs/screenshots/auction-dates.png) | Upcoming auction dates grouped by month. |

## Features

- **Daily aggregation** of auction objects from the court portal zvg-portal.de (all 16 federal states), zvg.com and hanmark.de, with photos, appraisal and expose PDFs, hearing dates and automatic archiving of expired or vanished objects.
- **AI analysis** of each object: land register, defects, encumbrances, energy certificate, condition, location, nearby places, land and income value. The daily run does a basic extraction; a full analysis with investment and fix-and-flip figures is started per object on demand. Analyses run through [Langdock](https://langdock.com) (Anthropic-compatible API), so a Langdock workspace and API key are required.
- **Investor view** with a single ranking score (`Chance`) plus confidence and data maturity, strategy presets, a deal desk for actual figures, and a calibration page that compares estimates with outcomes. Bear/base/bull underwriting is calculated on the server.
- **Custom-URL analysis**: the same analysis for an arbitrary listing, submitted as link, pasted page source, PDF, or link with the user's own session cookie. Includes an SSRF guard, `robots.txt` checks and per-domain rate limits.
- **Market reference** built from comparable offers per micro-market, used for the market-gap signal and for market-fairness checks on custom listings.
- **Search, map and alerts**: full-text search with filters, map view, saved-search alerts by e-mail (instant, daily, weekly), favorites, calendar export for hearings, acquisition cost calculator.
- **Accounts**: invitation-only, password login with optional TOTP and OpenID Connect, revocable device sessions, audit log.
- **Data quality**: range and consistency checks that flag instead of discard, a daily report, and safeguards against silent pipeline outages ([docs/DATA_QUALITY.md](docs/DATA_QUALITY.md)).
- **Operations**: Docker Compose stacks, Caddy, fail2ban, optional Prometheus/Alertmanager/Grafana, backup and restore scripts.

The user interface and the domain vocabulary are in German.

## Tech stack

| Layer | Technology |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query, MapLibre GL |
| Data | PostgreSQL 16, Drizzle ORM, Redis, MinIO |
| Auth | Auth.js v5 (credentials, optional OIDC), JWT sessions with server-side revocation |
| Scrapers | Python 3.12, Prefect 3, httpx, BeautifulSoup, Scrapling (HTML parser), pdfplumber, FastAPI |
| AI | Langdock (Anthropic API), instructor for structured output |
| Infrastructure | Docker Compose, Caddy, fail2ban, Prometheus, Alertmanager, Grafana |
| Quality | Vitest, pytest, ESLint, Prettier, Ruff, GitHub Actions |

## Architecture

```mermaid
flowchart LR
  S[Court and auction portals] --> P[Prefect flows<br/>Python]
  P -->|structured output| L[Langdock]
  P --> DB[(PostgreSQL)]
  P --> M[(MinIO)]
  U[User] --> W[Next.js app]
  W --> DB
  W --> M
  W -->|custom URL jobs| A[FastAPI scraper API]
  A --> DB
  P -->|alerts, reports| W
```

Details, schedules and the data model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Requirements: Node.js 22, pnpm 9 and Docker with the Compose plugin. Python 3.12 is only needed for the scrapers.

```bash
git clone <repository-url> gavel && cd gavel
pnpm install

# Compose variables and settings for the local app. The placeholder passwords
# in both files match, which is fine locally; change them for anything else.
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# PostgreSQL (host port 5434), Redis (6380) and MinIO (9000)
docker compose -f infra/docker/docker-compose.dev.yml --env-file .env up -d postgres redis minio

# Create the schema in the empty database (the database and role are still named "immopulse")
export DATABASE_URL=postgresql://immopulse:change-me@localhost:5434/immopulse
pnpm --filter web db:push

pnpm dev        # http://localhost:3000
```

There is no sign-up. Create the first user as described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#first-start). The database stays empty until the Prefect flows have run. `docker compose -f infra/docker/docker-compose.dev.yml --env-file .env --profile prefect up -d` starts a Prefect server and the worker; the AI steps need a Langdock key in `.env`.

Checks (all of them run in CI):

```bash
pnpm lint            # ESLint
pnpm format:check    # Prettier
pnpm typecheck       # tsc --noEmit
pnpm test            # Vitest, apps/web/__tests__/deps
pnpm build           # next build

cd scrapers
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -c requirements.txt -e ".[dev]"
ruff check . && ruff format --check .
python -m pytest tests -q
```

Production deployment, staging, backups and monitoring: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Configuration

Everything is configured through environment variables. [`.env.example`](.env.example) lists all of them with comments; the important ones are:

| Variable | Required | Purpose |
|---|---|---|
| `DOMAIN` | production | Public domain for Caddy and the host cron scripts |
| `NEXTAUTH_URL` | yes | Public origin of the app; used for links in e-mails and for origin checks (default `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | yes | Auth.js secret (`openssl rand -base64 32`) |
| `DB_PASSWORD`, `REDIS_PASSWORD` | yes | Passwords used by the Compose stacks |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | yes | MinIO credentials |
| `MINIO_PUBLIC_URL` | yes | Browser-reachable base URL of MinIO, without the bucket path |
| `LANGDOCK_API_KEY` | for AI analysis | Langdock API key |
| `LANGDOCK_BASE_URL`, `LANGDOCK_MODEL`, `LANGDOCK_EXTRACT_MODEL` | no | Endpoint and models for full and basic analysis |
| `KI_DAILY_LIMIT`, `KI_BACKUP_LIMIT` | no | Analyses per daily run and per 14:00 backup run (500 / 400) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | for e-mail | Alerts, reports and account e-mails |
| `ADMIN_EMAIL` | production | Recipient of the data-quality report, freshness alert and Alertmanager mails |
| `CRON_SECRET` | production | Bearer secret for `/api/cron/*`; the scoped variants `CRON_EMAIL_SECRET`, `CRON_OPS_SECRET`, `CRON_JOBS_SECRET` and `METRICS_SECRET` are optional |
| `SCRAPER_API_URL`, `SCRAPER_API_SECRET` | yes | Internal URL of the scraper API and its bearer secret |
| `ANALYSE_DAILY_LIMIT` | no | Custom-URL analyses per user and day (25) |
| `SCRAPE_*` | no | Minimum interval, hourly caps and cooldown for custom-URL fetches |
| `CONTACT_INFO` | recommended | Contact (e-mail or URL) appended to the User-Agent of all outbound requests |
| `RESPECT_ROBOTS_TXT` | no | `robots.txt` checks, on by default |
| `NEXT_PUBLIC_MAPTILER_KEY`, `MAPTILER_SERVER_KEY` | for maps | MapTiler keys |
| `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`, `AUTH_OIDC_NAME` | no | Enables OpenID Connect sign-in when all are set |
| `TRUST_PROXY_HEADERS`, `TRUST_PROXY_SECRET` | behind a proxy | Trust client IPs from proxy headers |
| `MISSING_TOLERANCE_DAYS` | no | Days without a sighting before a listing is archived (3) |
| `SUPPORT_EMAIL` | no | Support address on the login page |
| `SENTRY_DSN` | no | Error reporting for web and scrapers |
| `NEXT_PUBLIC_SITE_URL` | no | Build-time public origin for absolute image URLs |

## Scraping behaviour

What the code does, and what you have to do when you run it:

- **Honest, polite requests.** All outbound requests are plain HTTP GETs (and the portals' search forms) with the User-Agent `Gavel/1.0`, plus your `CONTACT_INFO` if you set one. No JavaScript is executed. `robots.txt` of every host is read and honoured; a disallowed path is not fetched. Sources have fixed delays between requests, and custom-URL fetches add a minimum interval per domain (default 8 s), hourly caps per domain and globally, and a cooldown after a block. Geocoding uses Nominatim at no more than one request per second.
- **Sources with bot protection are not fetched.** Gavel does not solve challenges, imitate browsers, rotate proxies or use third-party unblocking services. When a page answers with a challenge, a login wall or an access block, the domain goes into a cooldown, the job is reported as `BOT_BLOCKED`, and the source is skipped and logged. For a single listing the user can paste the page source or upload a PDF instead.
- **Login-protected listings** are not accessed with anyone's credentials. They reach the system through pasted HTML, an uploaded PDF, or a session cookie that the user pastes for one request; the cookie is neither stored nor logged.
- **Stored third-party content.** The ZVG scrapers copy listing photos, appraisals and expose PDFs into MinIO, and the appraisal text is sent to Langdock for analysis. Appraisals can contain personal data (for example names and addresses of the parties), and photos and documents are third-party works. Appraisal and expose PDFs are not publicly readable: the bucket policy denies anonymous access to them, Caddy answers 404 for their paths, and only logged-in users get them through the app. Storing them is not optional because the AI analysis reads the stored copy; if you cannot justify keeping them, do not run the scrapers for that source.
- **You are responsible for compliance.** Respect the terms of use of each source, the rules for personal data that apply to you, and the usage policies of the services you connect (Nominatim, MapTiler, Overpass, Langdock). The default settings are meant to be conservative, not a legal assessment.
- The application sets `noindex` and requires a login for every page except the login page.

## Roadmap

Small and unscheduled:

- Make the SQL migration history replayable on an empty database. New installs currently use `db:push` followed by `scripts/migrate.sh --baseline`.
- A user-invitation flow. Accounts are created in the database today.
- Resolve the two React Compiler warnings in `favoriten/client.tsx` and `favorite-button.tsx`, and remove the unused `resend` dependency.
- End-to-end tests for the main user flows and a CI job that starts the Compose stack.
- An English interface.

## License

MIT, see [LICENSE](LICENSE). Author: Jan Beinert.
