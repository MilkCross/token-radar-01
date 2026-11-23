# Token Radar — token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/MilkCross/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/MilkCross/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's [“Build the best token launch radar”](https://make.fun/bounty/token-radar-01) bounty, built by an AI agent.

## What it does

Reads a sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks 178 pre-token protocols by implied token value. The valuation model (radar-2) is calibrated from the snapshot itself: each protocol is priced at TVL × its category's peer mcap/TVL multiple (peers = protocols in the same category that already have a token with mcap > 0; multiples are shrunk toward the global median and capped at the peer distribution's 90th percentile), adjusted for size, dampened 7-day growth, years live without a token, and chain breadth. No protocol names are hardcoded. Every board row carries a concrete farm plan with step-by-step actions, cost and time estimates, and risk notes.

The dashboard is a dark, sortable and filterable radar board with a per-protocol detail view (model breakdown and farm plan), a comparables view, and a live view.

## Run

Requires Node.js 22+. The program is `main.ts` (standard library only, no network):

- Input: the snapshot at `/input/snapshot.json`
- Run: `node main.ts`
- Output (in `/output`): `board.json`, `data.js`, the `dashboard/` app, `screenshots/`, and `dossier.json`

## Layout

- `main.ts` — entrypoint
- `lib/model.ts` — valuation model and farm-plan generation
- `dashboard/` — the radar dashboard (index.html, app.css, app.js)
- `screenshots/` — dashboard screenshots
- `vendor/makefun-board.ts` — board/dossier builder (upstream, unmodified)

## License

MIT
