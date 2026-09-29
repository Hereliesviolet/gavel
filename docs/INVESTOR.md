# AI investor

The area under `/investor` finds ZVG opportunities with deterministic
strategies and ranks them by a single score, `Chance` (0-100), shown together
with `Konfidenz` and the machine-assessed evidence level `Datenreife`. The data
is `zvg_listings` joined with `zvg_ki_analyses`, so only listings with an AI
analysis appear. Definitions of every metric are in
[METRICS_GLOSSARY.md](./METRICS_GLOSSARY.md).

The output is an AI-generated assessment, not investment advice.

The investor area covers ZVG listings only. Custom-URL analyses feed the market
reference and the candidate promotion but have no investor feed of their own.

## Pages

Each page answers one question.

| Route | Question |
|---|---|
| `/investor` | What is worth my time today? |
| `/investor/suche` | What else fits my criteria? |
| `/investor/desk` | What am I working on? |
| `/investor/datenbasis` | What can I rely on? |

The investor profile (`/account/investor`) is linked from the sub-navigation; it
steers ranking and underwriting. The former strategy pages redirect to search
presets (`next.config.ts`), and `/investor?strategy=fix_flip` style links are
rewritten in `proxy.ts`.

### Today (`/investor`)

Up to three listings sorted by chance, with confidence and data maturity; the
movement of the last seven days from `zvg_auction_events` (value reductions,
repeat hearings, newly captured listings; a drop of more than two thirds is
treated as a partial-lot artefact and not shown as a reduction); a warning when a
desk item has a hearing within 14 days; a footer with the coverage rate.

The hero is the strongest de-duplicated chance with at least data maturity
`bewertbar` and `investment_score != abraten`. It is never a special situation
and never a pure deadline pick, and it excludes objects whose leading figure is
negative at the assumed purchase price (flip margin at or below 0, or negative
base cash flow). Those stay findable in search.

### Search (`/investor/suche`)

Strategies decide which listings enter a list; the order always comes from the
chance (except the deadline list, which sorts by hearing date).

| Strategy | Discovery signal |
|---|---|
| Fix & Flip | Flip classification, measures, cost range or ARV |
| Buy & Hold | Investment classification or a positive rent assumption |
| ZVG-Peer-Abweichung | Court value per m2 at least 10 % below a suitable ZVG peer median |
| Zeitnah | Hearing within the selected 7 or 30 days |

Presets (`lib/investor-finder.ts`): `fix-flip`, `buy-hold`, `unter-markt`,
`zeitnah`, `einsteiger-paket` (appraised value up to 350k, entry criteria, no
anti-signals), `flip-unter-150k` (fix and flip, up to 150k, ROI of at least 5 %)
and `cashflow-nrw` (buy and hold in North Rhine-Westphalia, yield of at least
3 %). Further filters: federal state, value range, hearing within N days, hide
anti-signals.

Anti-signals (part-ownership, right of residence, hereditary building right and
others in `lib/investor-risk.ts`) mark a special situation: the chance is capped
and the confidence is `keine`. The SQL pattern is generated from the same list as
the TypeScript predicates.

### Deal desk (`/investor/desk`)

A work list from favourited ZVG listings and everything with an entry in
`investor_deal_outcomes`. The status is set by the user and is separate from the
machine data maturity: `watching` (Beobachten), `examining` (Prüfen), `bid`
(Geboten), then `acquired`, `sold` or `rejected`. Each entry has a note and
optional actual figures (bid, hammer price, renovation, sale, rent, holding
period) that later calibrate the estimates. Two or three listings can be compared
side by side. `PUT /api/investor/outcomes` overwrites only the fields it
receives.

### Data basis (`/investor/datenbasis`)

Coverage per attribute (AI analysis, living area, market and rent reference, ARV,
lowest bid), the state of the market reference, the size of the hearing history
and market statistics for the whole inventory. Every row names its population:
living area refers to houses and flats only, because plots and commercial
objects have none.

The learning loop compares the first and latest evaluation run per attribute in
percentage points (a changed population is reported as such, not as progress) and
compares four model quantities with the actual figures from the deal desk: bid vs.
maximum bid, sale price vs. ARV, rent vs. rent assumption, renovation vs. cost
estimate. With fewer than five observations a row is marked as insufficient;
nothing is adjusted automatically.

## Underwriting

`lib/underwriting` (`UNDERWRITING_VERSION = "underwriting-v3-ein-modell"`)
calculates bear, base and bull cases on one stated purchase price assumption:
the lowest bid if it was read from the notice, otherwise a reference bid of
70 % of the appraised value. The appraised value is not treated as a purchase
price. Provisional maximum bids take the profile goals and known reserves into
account. Data maturity `verifiziert` needs the lowest bid and the surviving
rights, which the auction notice usually does not contain (section 44 ZVG), so
the level is rarely reached and this is visible on the listing.

## Endpoints and jobs

| Endpoint | Use |
|---|---|
| `GET/PUT/DELETE /api/investor/outcomes` | Deal desk |
| `GET/POST /api/investor/feedback` | Feedback on the investment memo |
| `GET/PATCH /api/investor/profile` | Investor profile |
| `GET /api/investor/quality` | Coverage and quality report (internal) |
| `POST /api/cron/market-candidates` | Promotes conspicuous market offers to a full analysis; daily 05:30 via `scrapers/market_candidates.sh` |
| `POST /api/cron/investor-evaluation` | Evaluation run with the coverage state; daily 05:45 via `scrapers/investor_evaluation.sh` |

Pages load their data on the server through `lib/investor-queries.ts`.

## Code map

- `lib/investor-picks.ts`: chance, confidence, hooks, `InvestorPick`
- `lib/investor-signals.ts`, `lib/investor-risk.ts`: signals, data maturity, anti-signals
- `lib/investor-queries.ts`, `lib/investor-finder.ts`: queries, filters, presets
- `lib/deal-desk.ts`, `lib/deal-desk-status.ts`: desk entries and statuses
- `lib/datenbasis.ts`, `lib/lernschleife.ts`: coverage report, calibration
- `lib/underwriting/`: the only money calculation
- `components/investor/`: UI
