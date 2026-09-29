# Data quality

Scraped listings and AI-extracted fields can be wrong in ways nobody notices
until a user stumbles over them. Gavel therefore validates data after
scraping and after AI analysis, and adds safeguards against the failure mode
where the whole pipeline silently stops writing.

## Principle

The validation layer (`scrapers/src/utils/data_quality.py`) runs **after** the
scrapers and the AI analysis and does not change their output. Suspicious values
are **never discarded or silently corrected**. They are stored as flags in
`zvg_listings.data_quality_flags` and logged. This avoids two errors at once:
real mistakes going unnoticed, and rare but genuine listings (a huge plot, a very
expensive flat) being hidden by an over-strict filter.

## Where the checks run

| When | Code | Purpose |
|---|---|---|
| After every AI analysis of a listing | `src/flows/ki_analysis.py` (`analyze_listing`) | Cross-validation of raw data against AI output; immediate flagging of new or re-analysed listings |
| Daily, step 7 of `daily_pipeline` | `src/flows/data_quality.py` (`run_quality_checks_task`, `generate_data_quality_report_task`) | Re-checks **all** active listings, then builds the daily report |
| Daily 15:30, `data-quality-backup-deployment` | `data_quality_flow` | Runs the same check if the main pipeline aborted earlier |
| Ad hoc | `scrapers/backfill_data_quality.py` (`--dry-run`, `--sample N`) | Manual full audit with sample output per problem type |

## Rules

All rules live in `data_quality.py`; the ranges are constants at the top of the
file. They are deliberately wide: they catch gross outliers, they are not strict
validation. `RULES_VERSION` is stored with every flag.

| Field | Rule | Severity |
|---|---|---|
| `wohnflaeche_m2` | 5 - 2,000 m2 | warning |
| `nutzflaeche_m2`, `gesamtflaeche_m2` | 5 - 100,000 m2 | warning |
| `grundstuecksflaeche_m2` | Plot: 10 - 5,000,000 m2; commercial: 10 - 500,000 m2; otherwise 5 - 50,000 m2 | warning |
| Living area vs. plot (category `haus` only) | Living area must not exceed 3x the plot area | warning |
| `zimmer` | 0.5 - 40 | warning |
| `baujahr` | 1800 to current year + 2 | warning |
| `verkehrswert` (absolute) | 1,000 - 50,000,000 EUR (commercial: up to 250,000,000) | critical |
| `verkehrswert` per m2 | Flat 200-15,000; house 150-12,000; commercial 30-12,000; plot 1-3,000 EUR/m2 | warning |
| `aktenzeichen` | Not empty (critical); contains a digit; only expected characters (`\w`, whitespace, `. - / # § ( )`); sane length | warning / critical |
| `termin_date` | More than 730 days ahead (info); in the past while `ist_aktiv` (warning, guards the archiving) | info / warning |
| `plz` | Five digits; first digit plausible for the federal state (anonymised `00xxx` postcodes from the court portal are skipped) | warning |
| `ausweisjahr` (AI) | 1995 to current year + 1 | warning |
| `endenergieverbrauch_kwh` (AI) | 0 - 600 kWh/m2a | warning |
| `effizienzklasse` vs. consumption (AI) | The class must roughly match the consumption value | warning |
| AI free-text fields | Very short or placeholder text such as "k.A." | info (does not set `needs_review`) |

Cross-validation (`cross_validate_ki_result`) compares values already stored by a
scraper with what the AI extracted from the appraisal: living area and plot area
within 15 %, rooms within 1 %, year of construction exactly. A deviation does not
overwrite anything; the stored value stays and a `ki_raw_mismatch` flag is
recorded. Because most of these fields currently come from the AI itself, this
mainly protects future sources and re-analyses.

## Storage

Migration `0005_data_quality_flags.sql` adds to `zvg_listings`:

- `data_quality_flags` (JSONB): array of `{field, reason, message, severity, value, expected, rules_version}`
- `needs_review` (boolean): true as soon as one flag has severity `warning` or `critical`
- `data_quality_checked_at` (timestamptz)

A partial index on `needs_review = true` and a GIN index on the flags support
admin queries. The table `data_quality_daily_stats` keeps daily totals by source
and problem type for the trend comparison.

## Report

`generate_data_quality_report_task()` aggregates the day, compares it with the
previous day, logs the result and, if `CRON_SECRET` is set, posts it to
`/api/cron/data-quality-report`, which e-mails an HTML report to `ADMIN_EMAIL`.
Set `ADMIN_EMAIL` to an address that is actually read.

## Safeguards against silent outages

These were added after a bug in the listing upsert made every write fail for
several days while the scheduler showed successful runs. As the last successful
write aged, the "not seen for `MISSING_TOLERANCE_DAYS`" rule expired nearly the
whole inventory in one run. Both mechanisms did what they were built to do; what
was missing were limits.

1. **Storage quota** (`src/utils/speicherquote.py`). Each scrape flow reports an error when
   fewer than 50 % of its storage attempts succeed. A few broken records are
   normal; falling below half needs a shared cause such as a faulty statement or
   a schema change. The ratio is per source, and runs with zero attempts (a
   holiday, an empty page) stay green. The run is then recorded with an error in
   `scrape_jobs` instead of as a success.
2. **Archiving brake** (`scrapers/archive_expired.sh`, hourly). The two archiving
   criteria run separately. An expired hearing date is verifiable and is always
   applied. Deactivating listings because they were not seen at the source is
   refused when a single run would affect more than `MAX_MISSING_SHARE_PERCENT`
   (default 20 %) of the active inventory: the script logs `ALARM` lines and exits
   with code 2. `--dry-run` only counts.
3. **Freshness watchdog** (`scrapers/check_freshness.sh`, hourly at minute 45).
   It asks one cause-agnostic question: how old is the newest `last_seen_at`
   among active listings? Above 26 hours (the threshold the UI uses for the
   "scraper online" indicator), or with no active listing at all, it posts to
   `/api/cron/data-freshness`, which e-mails `ADMIN_EMAIL`. A stamp file limits
   this to one mail per day; the file is removed when the inventory recovers. The
   watchdog is a separate cron entry on purpose: it must not live in the process
   it monitors. If the web container or SMTP is down, the script exits with 1 and
   the message survives in the cron log.

A regression test (`scrapers/tests/test_sql_platzhalter.py`) parses the asyncpg
calls in `src/storage/` statically and checks that placeholders run from `$1` to
`$N` and that `N` equals the number of arguments. That was the original bug and
it needs no database to find.

## Known limits

- A value assigned to the wrong lot of a multi-lot appraisal is only caught if it
  also falls outside a plausible range or a second source disagrees.
- Plausible but wrong AI free text is not detected; only very short or generic
  output is.
- Errors in the original court documents show up only when large enough to
  violate the EUR/m2 rules.
- Systematic bias inside the plausible range needs independent reference data,
  which is out of scope for this layer. User feedback remains the last line of
  defence.

## Adding sources or changing prompts

1. Keep the field names of `zvg_listings` / `zvg_ki_analyses`; `evaluate_listing()`
   expects them.
2. If a new source provides fields that only the AI extracted so far, store them
   on the listing before the AI run so `cross_validate_ki_result()` compares them.
3. For a new field with its own range, add a `check_*()` function and register it
   in `evaluate_listing()`. Bump `RULES_VERSION` when changing existing ranges.
4. After every prompt or model change run
   `python backfill_data_quality.py --dry-run --sample 5` and compare the top
   problem types with the values before the change, especially for `ausweisjahr`,
   `effizienzklasse` and the free-text fields.
5. Give every AI field a clear `Field(description=...)`, especially where it can
   be confused with a similar one. A missing description on `ausweisjahr` once
   made the model return the year of construction instead of the certificate's
   issue year.
