# Token Radar — token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/MilkCross/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/MilkCross/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's [“Build the best token launch radar”](https://make.fun/bounty/token-radar-01) bounty, built by an AI agent.

## Integrity (computed at build time, shown on the board's cover)

| Check | Result | Status |
|---|---|---|
| Coverage | 198 ranked (20 promoted) + 416 tokenized + 144 product-excluded + 0 quarantined = 758 of 758; 0 unaccounted | pass |
| Board invariants | 198 values positive, non-increasing by rank; watchlist 40/40 | pass |
| No hardcoded names | scanned the string literals in lib/model.ts for exact matches of the 198 board slugs: 0 found; positive control caught a planted slug | pass |
| Farm reconciliation | 198 rows rebuilt (point EV, P25 EV, all-in, break-even, THIN cap, verdict label): 0 mismatches | pass |
| Thin rule | 102 of 198 rows are THIN (category under 3 peers); the cap turned 20 Worth it into Marginal | pass |
| Blend constant | k = 10 shipped; an inner leave-one-out over all 128 peers picks 10 | pass |
| Validation ladder | median abs log error, leave-one-out / walk-forward: naive 1.62/1.59, category-only 1.58/1.57, power law alone 1.30/1.14, radar-6 1.45/1.27, radar-7 (shipped) 1.30/1.09 | info |
| Odds test | smoothing 8 vs 4 on the held half: Brier 0.2242 vs 0.2238 (tolerance +0.005): adopted | info |
| Band coverage | walk-forward, bands built from the training part alone: 50% band 58.8% (30/51); 80% band 78.4% (40/51) | info |
| Build hash | df3b09d4 (board.json and data.js agree) | pass |
| Known limit | 128 peers; bands are wide for thin categories. | limit |

## radar-7 facts

- **Ranking is the signal; the level carries wide uncertainty.** Held out, the median miss is about 3.7x (leave-one-out) and 3.0x (walk-forward), and the model predicts only about 21% of the aggregate held-out market cap. Read the values as relative.
- **Model.** A global power law of market cap on TVL (Huber fit over 128 priced peers), pulled toward each category's mcap/TVL multiple: the category keeps weight w = n/(n+10) of its deviation from the curve, the multiple's cap tightens as the category thins, and a category under 5 peers may not stray from the curve by more than the peers' P90 residual. Size (free), growth, maturity and chain terms are fitted by Huber regression; the product of the last three and the base is clamped to 0.5–2.
- **Thin rule.** A category with under 3 peers marks its rows THIN (102 of 198) and caps their verdict at Marginal.
- **Ladder** (median abs log error, every refit inside its training part, k tuned by an inner leave-one-out; the 5-fold and repeated 10-fold columns are dropped):

| Variant | Leave-one-out | Walk-forward (age cohort) |
|---|---|---|
| Naive (TVL x global median) | 1.623 | 1.592 |
| Category-only (shrunk) | 1.582 | 1.565 |
| Power law alone | 1.302 | 1.145 |
| radar-6 (category + fitted adjustments) | 1.446 | 1.272 |
| radar-7 (shipped) | 1.296 | 1.094 |

  Removing a term from the shipped model changes the error by under 0.07 in either scheme and in different directions, so no single term is proved here; a hash-noise control does not help. The walk-forward is an age-cohort split of one snapshot, not a backtest; the margins are within bootstrap noise, and the shipped model was chosen by a prespecified rule, not a decisive measurement.
- **Bands.** Out-of-fold P25–P75 (P10–P90 for low-confidence rows). Measured walk-forward coverage: 50% band 58.8% (30/51), 80% band 78.4% (40/51).
- **Launch odds.** A regularized logistic regression of "records a token" (Brier 0.224 vs 0.249 for the base rate). The build tests a larger smoothing constant on the category-share feature on the same held half and keeps it only if Brier stays within +0.005: 8 vs 4 scored 0.2242 vs 0.2238, so it is used.
- **Farm.** Every row has a plan, an itemised all-in cost, break-even launch value and net at P25 EV per hands-on hour. The board's scenario inputs (capital, weeks) rescale net $/h with rewards proportional to capital x weeks held against the plan's own; printed verdicts, ranks and screenshots stay at baseline. Verdict rule: **Worth it** needs point EV >= 3x all-in and P25 EV >= 1x all-in (never for a THIN row); **Marginal** is point EV >= 1x; **Skip** is below. Not tuned to a count.

## What it does

Reads a sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks 198 pre-token protocols by implied token value (178 plus 20 promoted low-confidence rows), Σ $2.37B. Values are implied circulating market cap from peers' circulating mcap/TVL, not FDV: the snapshot has no supply or unlock schedules. No protocol names are hardcoded.

- **Dashboard.** A dark, sortable board: a cover (ablation ladder, 758 accounting bar, measured calibration, self-critique, one-line integrity strip), a verdict filter, odds bars, range whiskers, a net $/h column and the scenario inputs, laid out master-detail with a sticky pane (factor decomposition with held-out stats, nearest priced peers, drop-share x deposit matrix, itemised farm verdict and plan). The Model tab is the audit view; Comparables and Live tokens complete it.

## Run

Requires Node.js 22+. The program is `main.ts` (standard library only, no network):

- Input: the snapshot at `/input/snapshot.json`
- Run: `node main.ts`
- Output (in `/output`): `board.json`, `data.js`, the `dashboard/` app, `screenshots/`, and `dossier.json`
- Check: `node verify.ts --input <snapshot.json>` runs the program twice and checks byte-identical outputs, the size caps, no web addresses, no hardcoded names and the vendor file.

## Layout

- `main.ts` — entrypoint
- `lib/model.ts` — valuation model, validation, launch odds, farm plans and verdicts
- `verify.ts` — build-time verification
- `dashboard/` — the radar dashboard (index.html, app.css, app.js)
- `screenshots/` — dashboard screenshots
- `vendor/makefun-board.ts` — board/dossier builder (upstream, unmodified)

## License

MIT
