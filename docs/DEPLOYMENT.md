# Deployment and operations

This describes a single-host Docker Compose deployment. Commands are run from
the repository root unless stated otherwise. Names in angle brackets are yours
to choose.

## Prerequisites

- A Linux host with Docker and the Compose plugin, and a DNS A record for your
  domain.
- SMTP credentials, a Langdock API key ([AI analysis](./ARCHITECTURE.md#ai-analysis))
  and a MapTiler key.
- A Prefect 3 server that the worker and scraper containers can reach. The
  compose file expects it at `PREFECT_API_URL` (default
  `http://prefect-server:4200/api`) on the Docker network `PREFECT_NETWORK`
  (default `prefect_network`). One way to provide it:

  ```bash
  docker network create prefect_network
  docker run -d --name prefect-server --network prefect_network --restart always \
    -v prefect_data:/root/.prefect \
    prefecthq/prefect:3-latest prefect server start --host 0.0.0.0
  ```

  Prefect's own documentation covers production setups with a database and
  authentication.

## Configuration

```bash
cp .env.example .env
```

Replace every `change-me`, set `DOMAIN`, `NEXTAUTH_URL` and `MINIO_PUBLIC_URL`
to your public HTTPS origin, and configure SMTP. The full list is in the
README. `NEXT_PUBLIC_MAPTILER_KEY` and `NEXT_PUBLIC_SITE_URL` are read when the
web image is built; changing them needs `--build`.

## First start

```bash
cd infra/docker
docker compose -f docker-compose.prod.yml --env-file ../../.env up -d --build
```

This starts PostgreSQL, Redis, MinIO, the web app, the scraper API, the Prefect
worker and a Caddy proxy that obtains a certificate for `DOMAIN`. A fresh
PostgreSQL volume is initialised with the `pg_trgm` extension
(`infra/docker/initdb`).

Create the schema in the empty database. (The PostgreSQL database and role are still named `immopulse`; the product name changed, the database identifiers did not.) The SQL files in
`apps/web/drizzle/migrations` are incremental changes to an existing database
and do not replay on an empty one, so build the schema from the TypeScript
definitions and mark the migrations as applied:

```bash
export DATABASE_URL=postgresql://immopulse:<DB_PASSWORD>@<host>:5432/immopulse
pnpm install && pnpm --filter web db:push
./scripts/migrate.sh --baseline
```

PostgreSQL is not published on the host in the production stack. Either run
`db:push` from a container on `gavel_net` or temporarily publish the port
through an override file.

There is no sign-up form and no seed script. Create the first user in the
database with a bcrypt hash of the password:

```bash
HASH=$(cd apps/web && node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" '<password>')
docker exec -i gavel_postgres psql -U immopulse -d immopulse -c \
  "INSERT INTO users (email, name, password_hash, role) VALUES ('admin@example.com', 'Admin', '$HASH', 'admin');"
```

## Reverse proxy

The bundled Caddy service binds ports 80 and 443. If another proxy already uses
them, do not start `caddy`; attach `web` and `minio` to that proxy's network
instead:

```bash
cd infra/docker
SHARED_CADDY_NETWORK=<network of your proxy> \
docker compose -f docker-compose.prod.yml -f docker-compose.shared-caddy.yml \
  --env-file ../../.env up -d postgres redis minio web scraper prefect-worker
```

Then add a site block for your domain to the existing proxy, based on
`infra/caddy/Caddyfile`. `USE_SHARED_CADDY=1` makes `scripts/deploy.sh`,
`rollback.sh` and `recreate-prefect-worker.sh` include the override.

## Migrations

`scripts/migrate.sh` applies `apps/web/drizzle/migrations` to the running
PostgreSQL container and records each file in `drizzle.__drizzle_migrations`
(same format as `drizzle-kit migrate`: `hash` is the SHA-256 of the file,
`created_at` the `when` value from `meta/_journal.json`). Order comes from the
journal.

```bash
./scripts/migrate.sh --check      # exit 1 if migrations are pending
./scripts/migrate.sh              # apply pending migrations
./scripts/migrate.sh --baseline   # mark all as applied without running them
```

Run `--check` before every deploy. To add a migration, create the next numbered
SQL file, add its entry to `meta/_journal.json` and commit both. Do not edit a
migration that has been applied anywhere: the hash would no longer match and
the file would be applied again.

`drizzle-kit generate` is not usable at the moment: `meta/` contains only
`0000_snapshot.json`, so migrations are written by hand.

## Deploying updates

```bash
./scripts/deploy.sh                       # checks migrations, snapshots images,
                                          # rebuilds, smoke-tests, rolls back on failure
APPLY_MIGRATIONS=1 ./scripts/deploy.sh    # apply pending migrations first
./scripts/rollback.sh                     # start the previous images manually
```

The smoke test calls `/api/health` in the web container and
`/internal/health` in the scraper container. Never deploy code that needs
columns before the migration that creates them has run.

To recreate only the worker without interrupting a running daily pipeline or
AI run, use `scripts/recreate-prefect-worker.sh`; it refuses while the
`gavel-heavy-worker` advisory lock is held.

## Staging

A separate stack with its own containers, volumes and ports (web 3001,
PostgreSQL 5435). Do not combine it with the production compose file.

```bash
cp .env.example .env.staging     # own secrets; NEXTAUTH_URL=http://localhost:3001
./scripts/staging-up.sh
PG_CONTAINER=gavel_staging_postgres ./scripts/migrate.sh
```

## Containers

| Container | Role |
|---|---|
| `gavel_web` | Next.js app |
| `gavel_scraper` | FastAPI service only (custom-URL analysis, health, metrics) |
| `gavel_prefect_worker` | Scheduled flows: scrapes, AI analysis, geocoding, data quality, market harvest |
| `gavel_postgres`, `gavel_redis`, `gavel_minio` | Data stores |
| `gavel_caddy` | Reverse proxy (skipped with a shared proxy) |

`scraper` and `prefect-worker` use the same image.

## Host cron jobs

The wrapper scripts in `scrapers/` call the app's cron routes over the public
domain and read `DOMAIN` and the cron secrets from `.env`. Example crontab
(adjust the path):

```cron
0 * * * *   /path/to/gavel/scrapers/archive_expired.sh   >> /var/log/gavel-archive.log 2>&1
0 * * * *   /path/to/gavel/scrapers/check_alerts.sh      >> /var/log/gavel-alerts.log 2>&1
45 * * * *  /path/to/gavel/scrapers/check_freshness.sh    >> /var/log/gavel-freshness.log 2>&1
15 4 * * *  /path/to/gavel/scrapers/wohnflaeche_backfill.sh >> /var/log/gavel-wohnflaeche.log 2>&1
30 5 * * *  /path/to/gavel/scrapers/market_candidates.sh  >> /var/log/gavel-candidates.log 2>&1
45 5 * * *  /path/to/gavel/scrapers/investor_evaluation.sh >> /var/log/gavel-evaluation.log 2>&1
15 3 * * *  SKIP_MINIO=1 /path/to/gavel/scripts/backup.sh >> /var/log/gavel-backup.log 2>&1
30 3 * * 0  /path/to/gavel/scripts/backup.sh              >> /var/log/gavel-backup.log 2>&1
```

`archive_expired.sh`, `wohnflaeche_backfill.sh` and `backup.sh` talk to the
containers with `docker exec`, so they run on the Docker host. See
[DATA_QUALITY.md](./DATA_QUALITY.md) for the safeguards in `archive_expired.sh`
and `check_freshness.sh`.

## Backup and restore

`scripts/backup.sh` writes a PostgreSQL custom-format dump and, unless
`SKIP_MINIO=1`, a tarball of the MinIO volume to
`/var/backups/gavel/<UTC stamp>/` (override with `BACKUP_ROOT`). Retention:
`KEEP_DAYS` (default 14) for whole backups, `KEEP_MINIO_COPIES` (default 2) for
the large MinIO tarballs. The MinIO volume name is taken from `MINIO_VOLUME`
(default `gavel_minio_data`).

Test restores go into a throw-away database, never into the live one:

```bash
./scripts/restore.sh        # restores the newest dump into gavel_restoretest
# compare row counts with production, then:
docker exec gavel_postgres psql -U immopulse -d postgres \
  -c "DROP DATABASE gavel_restoretest;"
```

A live restore needs an explicit confirmation:
`LIVE=1 CONFIRM=OVERWRITE_PROD ./scripts/restore.sh`.

## Monitoring

```bash
cd infra/docker
docker compose --env-file ../../.env -f docker-compose.prod.yml \
  -f docker-compose.monitoring.yml up -d prometheus alertmanager grafana
```

Prometheus scrapes `scraper:8000/internal/metrics` and `web:3000/api/metrics`
(bearer tokens from `SCRAPER_API_SECRET` and `METRICS_SECRET`; set
`METRICS_SECRET`, the compose file passes it on without a default). Rules are
in `infra/monitoring/alert-rules.yml`. Alertmanager posts firing alerts to
`/api/cron/ops-alert`, which e-mails `ADMIN_EMAIL` through the SMTP settings.
`/internal/health` and `/api/health` return JSON for smoke tests and are not
scrapeable. Grafana and Prometheus listen only on the internal network; add a
Caddy site block or a port mapping to reach the Grafana UI.

Set `SENTRY_DSN` to report unhandled errors from the web app and the scrapers.

## fail2ban

`infra/fail2ban` contains a jail for repeated 401/403/404 responses and one for
login POSTs, based on Caddy's JSON access log. The install steps and the
`logpath` to adapt are in `caddy-jail.conf`.

## Stored third-party content

The ZVG scrapers copy listing photos, appraisals and expose PDFs into the MinIO
bucket `zvg-images`, and the AI analysis reads the stored copy. Appraisals can
contain personal data. The bucket policy denies anonymous reads of appraisal and
expose PDFs and of custom-URL images, Caddy answers 404 for those paths, and the
app streams them to logged-in users only. Photos are readable through the public
image path. Plan retention and backups for this data, and decide whether you may
keep it at all before enabling a source.

## Security notes for custom-URL analysis

- Any public https URL may be submitted. The scraper checks `robots.txt`, resolves
  the host, blocks private and reserved addresses, checks every redirect and
  connects to the validated IP. It does not get around bot protection; such pages
  are reported as blocked. Details in [CUSTOM_URL_ANALYSIS.md](./CUSTOM_URL_ANALYSIS.md).
- Private or login-protected listings are not fetched with someone else's
  credentials. They enter the system only through an explicit user action: pasted
  HTML, an uploaded PDF, or a session cookie that the user pastes for one fetch.
- A user can delete only listings they submitted. The login redirect accepts
  relative paths only.
