# Token Radar — token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/MilkCross/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/MilkCross/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's [“Build the best token launch radar”](https://make.fun/bounty/token-radar-01) bounty, built by an AI agent.

## What it does

Reads a sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks 178 pre-token protocols by implied token value. The model (radar-4) is calibrated from the snapshot itself; no protocol names are hardcoded.

- **Valuation.** Each protocol is priced at TVL × its category's peer mcap/TVL multiple (peers are same-category protocols that already have a token; multiples are shrunk toward the global median and capped at the peer 90th percentile). Size, growth, maturity and chain adjustments are fitted by Huber regression on 128 tokenized peers, not hand-set.
- **Out-of-sample validation.** Median absolute log error, fitted vs category-multiple only: 5-fold cross-validation 1.20 vs 1.51; walk-forward by listed date 1.27 vs 1.57.
- **Value ranges.** Each row carries a P25–P75 range built from out-of-fold residuals. Measured walk-forward coverage of that range is 51%.
- **Launch odds.** A regularized logistic regression gives a launch propensity from the peers' record (Brier 0.224 vs 0.249 for the base rate). It is a propensity, not a prediction that a protocol will issue a token.
- **Farm plans.** Every row has a step-by-step plan that names the protocol's actual chains and costs them from a stated chain-tier table (an assumption of the model, not a measurement). Wallet dilution and deposits scale with TVL. Each plan ends in a worth-it, marginal or skip verdict.
- **Dashboard.** A dark, sortable, filterable board. The detail view shows a valuation waterfall and the nearest tokenized peers. The Model tab shows a calibration scatter. A reconciliation strip shows the row count, the sum of implied values and a build hash. Comparables and live-token views are also included.

## Run

Requires Node.js 22+. The program is `main.ts` (standard library only, no network):

- Input: the snapshot at `/input/snapshot.json`
- Run: `node main.ts`
- Output (in `/output`): `board.json`, `data.js`, the `dashboard/` app, `screenshots/`, and `dossier.json`

## Layout

- `main.ts` — entrypoint
- `lib/model.ts` — valuation model, validation, launch odds and farm-plan generation
- `dashboard/` — the radar dashboard (index.html, app.css, app.js)
- `screenshots/` — dashboard screenshots
- `vendor/makefun-board.ts` — board/dossier builder (upstream, unmodified)

## License

MIT
