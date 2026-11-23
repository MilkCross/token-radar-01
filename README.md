# Token Radar — token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/MilkCross/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/MilkCross/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's [“Build the best token launch radar”](https://make.fun/bounty/token-radar-01) bounty, built by an AI agent.

## Integrity (computed at build time, shown as chips on the board)

| Check | Result | Status |
|---|---|---|
| Coverage | 198 ranked (20 promoted) + 416 tokenized + 144 product-excluded + 0 quarantined = 758 of 758; 0 unaccounted | pass |
| Board invariants | 198 values positive, non-increasing by rank; watchlist 40/40 | pass |
| No hardcoded names | scanned 420 string literals in lib/model.ts (88885 bytes) for exact matches of 198 board slugs: 0 found; positive control caught a planted slug; name-only coincidence, not a slug: Abstract (a chain name in the cost-tier table) | pass |
| Farm reconciliation | 198 rows rebuilt (point EV, P25 EV, all-in, break-even, verdict label): 0 mismatches | pass |
| Validation ladder | median abs log error, full / category-only / naive: 5-fold 1.20/1.51/1.63, 10-fold x3 1.43/1.57/1.62, LOO 1.45/1.58/1.62, walk-forward 1.27/1.57/1.59 | info |
| Band coverage | walk-forward: 50% band 51.0% (26/51) vs 50% nominal; 80% band 78.4% (40/51) vs 80% nominal | info |
| Build hash | dc205a80 (board.json dc205a80, data.js dc205a80) | pass |
| Known limit | 128 peers; bands are wide for thin categories. | limit |

## radar-6 facts

- **Point estimates frozen.** The 178 radar-5 rows keep identical value, odds, range and farm inputs; only ranks shift where a promoted row inserts above them.
- **Validation ladder** (median abs log error, multiples, shrinkage and Huber refit inside every training part; the 10-fold column pools 3 repeats):

| Variant | 5-fold | 10-fold x3 | Leave-one-out | Walk-forward |
|---|---|---|---|---|
| Naive (global median) | 1.632 | 1.618 | 1.623 | 1.592 |
| Category-only (shrunk) | 1.508 | 1.569 | 1.582 | 1.565 |
| Full model (+ Huber) | 1.204 | 1.435 | 1.446 | 1.272 |

  The full model's edge is 0.80x category-only under 5-fold but 0.91x under leave-one-out, so the 5-fold figure is the flattering one. Leave-one-category-out (full model, 11 categories): 1.183 vs 1.555 category-only and 1.501 naive, but worse than the naive multiple for CEX, Dexs and Lending individually. Ablation under 5-fold (change vs full 1.204): ln TVL +0.323, 7d change +0.004, ln age +0.000, ln chains +0.000; only ln TVL does real work. Not tuned inside the folds: the shrinkage weight 8, the p90 cap level, the thin-category threshold 3, the Huber delta 1.345 and the 60/40 walk-forward split were set during development with the full peer set in view, so every error here is mildly optimistic.
- **Bands.** 50% band walk-forward coverage 51.0% (26/51); 80% band 78.4% (40/51).
- **Set-aside audit.** The 20 protocols radar-5 left unranked all have TVL at or above the $50M floor and at least one chain, so all 20 are promoted (low confidence, 80% band, WHY line states the multiple's source) and 0 are quarantined. Circle Gateway (cross-chain bridge), USDCx (stablecoin wrapper) and Figure Markets Exchange look like product types but are not caught by the exclusion rules, so they are priced and flagged.
- **Farm economics.** Each row shows break-even launch value (all-in x wallets / (5% x odds)), net at P25 and its ROI, and net at $2,500 / $10,000 / $50,000 deposits (only the opportunity term moves). Rank ranges such as #14 [10-20] place the row's displayed range ends in the point-value ordering.

## What it does

Reads a sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks 198 pre-token protocols by implied token value (178 as in radar-5 plus 20 promoted low-confidence rows). The model (radar-6) is calibrated from the snapshot itself; no protocol names are hardcoded.

- **Valuation.** Values are implied circulating market cap, from peers' circulating mcap/TVL. They are not FDV: the snapshot has no supply or unlock schedules. Each protocol is priced at TVL × its category's peer mcap/TVL multiple (peers are same-category protocols that already have a token; multiples are shrunk toward the global median and capped at the peer 90th percentile). Size, growth, maturity and chain adjustments are fitted by Huber regression on 128 tokenized peers, not hand-set.
- **Out-of-sample validation.** Median absolute log error, fitted vs category-multiple only: 5-fold cross-validation 1.20 vs 1.51; walk-forward by listed date 1.27 vs 1.57.
- **Value ranges.** Each row carries a P25–P75 range built from out-of-fold residuals. Measured walk-forward coverage of that range is 51%.
- **Launch odds.** A regularized logistic regression gives a launch propensity from the peers' record (Brier 0.224 vs 0.249 for the base rate). It is a propensity, not a prediction that a protocol will issue a token.
- **Farm plans.** Every row has a step-by-step plan that names the protocol's actual chains and costs them from a stated chain-tier table (an assumption of the model, not a measurement). Wallet dilution and deposits scale with TVL.
- **Verdict rule.** All-in cost = fees + hands-on hours × $15 + a capital opportunity term, deposit × 4.5% APR × hold weeks / 52 (the hold is the plan's own, 21 to 60 days; 8 weeks would apply only to a plan with none). P25 expected value per wallet = P25 value × launch odds × 5% pool / wallets. **Worth it** needs point EV ≥ 3× all-in cost and P25 EV ≥ 1× all-in cost; **Marginal** is point EV ≥ 1× all-in cost but not Worth it; **Skip** is point EV < 1×. The thresholds are not tuned to a target count.
- **Dashboard.** A dark, sortable board with a verdict filter, laid out master-detail: the table on the left, a sticky detail pane on the right (facts, valuation waterfall, nearest tokenized peers, farm plan and itemised verdict). Thin categories show cross-category peers, tagged as context only: they did not enter the value. The Model tab shows a calibration scatter and the basis note. A reconciliation strip shows the row count, the sum of implied values and a build hash. Comparables and live-token views are also included.

## Run

Requires Node.js 22+. The program is `main.ts` (standard library only, no network):

- Input: the snapshot at `/input/snapshot.json`
- Run: `node main.ts`
- Output (in `/output`): `board.json`, `data.js`, the `dashboard/` app, `screenshots/`, and `dossier.json`

## Layout

- `main.ts` — entrypoint
- `lib/model.ts` — valuation model, validation, launch odds, farm-plan generation and verdicts
- `dashboard/` — the radar dashboard (index.html, app.css, app.js)
- `screenshots/` — dashboard screenshots
- `vendor/makefun-board.ts` — board/dossier builder (upstream, unmodified)

## License

MIT
