// The token radar's model (radar-4): one snapshot of the protocol universe in, one ranked board out.
//
// A protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id, no
// symbol). Implied value is calibrated on the snapshot's own token-bearing protocols (the peers):
//
//   ratio          = mcap / tvl, for every protocol with a market cap and TVL above zero
//   cap            = p90 of all peer ratios (nearest-rank); peerMultiple = min(shrunk, cap)
//   peerMultiple   = (n x categoryMedian + 8 x globalMedian) / (n + 8)   (n = peers in the category)
//   implied        = max(1, round(tvl x peerMultiple x baseAdj x sizeAdj x growthAdj x maturityAdj x chainAdj x clamp))
//
// The adjustments are fitted, not hand-set. A Huber IRLS regression over the peers explains
// log(mcap / (tvl x categoryMultiple)) from [ln tvl, clamped 7d change, ln age in years, ln chains]: start from
// OLS, then exactly 25 reweighted least-squares passes with Huber weights (delta = 1.345 x MAD of the residuals,
// recomputed each pass; a MAD of 0 stops early). Each factor is exp(coefficient x (feature - peer mean)),
// clamped to [0.5, 2]; baseAdj is exp(intercept); the combined adjustment is clamped to [0.5, 2] as well
// (`clamp` is the factor that does it, 1 unless it binds). A degenerate fit falls back to the radar-2 constants.
//
// Validation, both out of sample: 5-fold CV (fold = sum of the slug's char codes % 5; each fold is predicted by
// a model refit on the other four) and walk-forward (fit on the earliest 60% by listed date, test on the latest
// 40%; peers with no listed date count as oldest). Both report the median absolute log error of the fitted
// model and of the category multiple alone. Bands: the empirical P25/P75 of the 5-fold out-of-fold residuals
// log(actual / predicted) scale every row's implied value into [low, high]; their coverage is measured on the
// walk-forward test peers.
//
// Launch propensity: a logistic regression (L2 lambda 1 on non-intercept weights, Newton, exactly 50 iterations
// from zero) of "records a token" on the protocols in scope (the snapshot less the product types the board
// excludes), from the category's shrunk tokenized share (leave-one-out), ln TVL (z-scored), ln chains and ln age.
// Scored on a slug-parity split by Brier score against the base rate. It describes the record; it is no forecast.
//
// A category with fewer than 3 peers blends in its family's multiple (weight (3 - n) / 3).
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}


/** Model constants: the dashboard states them. */
export interface ModelConstants {
  prior_weight: number;
  size_knee_usd: number;
  size_slope: number;
  growth_up: number;
  growth_down: number;
  growth_scale: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_cap_days: number;
  maturity_scale_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  prior_weight: 8,
  size_knee_usd: 10_000_000,
  size_slope: 0.07,
  growth_up: 0.3,
  growth_down: 0.45,
  growth_scale: 25,
  maturity_floor: 0.75,
  maturity_range: 0.45,
  maturity_cap_days: 1095,
  maturity_scale_days: 90,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap: 7,
};

export const MODEL_VERSION = 'radar-4';

/** radar-4 fixed choices: the dashboard states them. */
export const FIT = {
  thin_peers: 3,
  confidence_k: 8,
  factor_min: 0.5,
  factor_max: 2,
  growth_clamp: 50,
  min_age_days: 7,
  min_fit_peers: 12,
  huber_iters: 25,
  huber_k: 1.345,
  cv_folds: 5,
  walk_train_share: 0.6,
  band_lo: 0.25,
  band_hi: 0.75,
  logit_iters: 50,
  logit_lambda: 1,
  logit_ridge: 1e-9,
  odds_smoothing: 4,
  odds_min: 0.02,
  odds_max: 0.95,
  airdrop_pool_share: 0.05,
  hour_value_usd: 15,
  worth_ratio: 3,
  marginal_ratio: 1,
};

/** Early rows carried below the watchlist floor, by implied value. */
export const EARLY_ROWS = 200;

/** Live-token protocols shown apart, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
  /** Fees spent in this step, midpoint of the stated range (capital is returned on exit, so it is not a cost). */
  cost_usd: number;
  /** Hands-on hours in this step; waiting while the position is held counts as zero. */
  hours: number;
}

/** The model's workings for one row. */
export interface ModelBreakdown {
  peer_multiple: number;
  peer_count: number;
  size_adj: number;
  growth_adj: number;
  maturity_adj: number;
  chain_adj: number;
  base_adj: number;
  confidence: number;
  age_days: number | null;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  launch_odds: number;
  risk_adjusted_usd: number;
  launch_basis: { tokenized: number; pre_token: number };
  model: ModelBreakdown;
  farm_steps: string[];
  farm_cost_usd: number;
  farm_hours: number;
  farm_verdict: string;
}

/** A farm plan's data-derived figures: the dashboard states every one. */
export interface PlanFigures {
  participants: number;
  deposit_usd: number;
  /** Expected airdrop per wallet: implied x odds x pool share / participants. */
  ev_wallet_usd: number;
  chains: { name: string; tier: string; cost_usd: number }[];
  chain_cost_usd: number;
}

/** One tokenized peer of the same category, nearest in TVL. */
export interface NearPeer {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** The dashboard's view of one row: the board row plus the farm plan split into its parts. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  launch_odds: number;
  risk_adjusted_usd: number;
  launch_basis: { tokenized: number; pre_token: number };
  model: ModelBreakdown;
  farm_steps: string[];
  farm_cost_usd: number;
  farm_hours: number;
  farm_verdict: string;
  /** Peers' P25..P75 of the out-of-fold residual, applied to the implied value. */
  value_low: number;
  value_high: number;
  /** The shrunk tokenized share of the row's category, the logistic's first feature. */
  cat_share: number;
  /** Combined-adjustment clamp factor, 1 unless the [0.5, 2] clamp binds. */
  clamp_adj: number;
  /** Valuation waterfall: [label, factor, running value]; the base value comes first, the implied value last. */
  waterfall: [string, number | null, number][];
  nearest: NearPeer[];
  plan: PlanFigures;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparables. */
export interface PeerRow {
  category: string;
  n: number;
  median_multiple: number;
  /** The multiple the model uses: shrunk, thin-blended, capped. */
  multiple: number;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  protocols_scanned: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median_multiple: number;
  peer_cap_multiple: number;
  peer_total: number;
  rows: RadarRow[];
  live: LiveRow[];
  peers: PeerRow[];
  fit: FitReport;
  coverage: Coverage;
  odds: OddsReport;
  farm: FarmAssumptions;
  /** Reconciliation: the board's row count, its implied total and an FNV-1a hash of slug+implied in rank order. */
  recon: { rows: number; sum_implied_usd: number; build: string };
}

/** The farm model's stated assumptions. */
export interface FarmAssumptions {
  airdrop_pool_share: number;
  hour_value_usd: number;
  worth_ratio: number;
  marginal_ratio: number;
  tiers: { tier: string; label: string; cost_usd: number }[];
  dilution: typeof DILUTION;
  deposit: typeof DEPOSIT;
  action_fee_share: number;
  max_chains: number;
}

/** The launch propensity and its held-half check. */
export interface OddsReport {
  global_rate: number;
  smoothing: number;
  categories: OddsRow[];
  features: string[];
  coefficients: number[];
  lambda: number;
  iterations: number;
  n_scope: number;
  n_train: number;
  n_test: number;
  brier_propensity: number;
  brier_base: number;
}

/** Out-of-sample errors of the fitted model and of the category multiple alone. */
export interface ErrorPair {
  n: number;
  fitted: number;
  baseline: number;
}

/** The fit and its validation, as the dashboard shows them. */
export interface FitReport {
  fit_method: string;
  features: string[];
  coefficients: number[];
  means: number[];
  fallback: boolean;
  peers_fit_all: number;
  /** Median absolute log error out of fold (5-fold CV): fitted vs category multiple alone. */
  error_fitted: number;
  error_median_only: number;
  cv: ErrorPair & { folds: number };
  walk: ErrorPair & { n_fit: number; from: string; to: string; undated: number };
  /** Empirical quantiles of the out-of-fold residual ln(actual / predicted), and the walk-forward coverage of the band they make. */
  band: { q25: number; q75: number; coverage: number; inside: number; n: number };
  /** Out-of-fold [log10 predicted, log10 actual] for every peer. */
  scatter: [number, number][];
}

/** Every protocol in the snapshot has exactly one disposition; the buckets sum to total. */
export interface Coverage {
  total: number;
  tokenized: number;
  ranked: number;
  excluded: number;
  excluded_reasons: Record<string, number>;
  other_pre_token: number;
  floor_usd: number;
  as_of: string;
}

/** One category's launch odds and the counts behind it. */
export interface OddsRow {
  category: string;
  tokenized: number;
  pre_token: number;
  odds: number;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}


/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}


const DAY_MS = 86_400_000;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

/** Why a pre-token protocol is a product type the board does not rank, or null. The first matching reason wins. */
export function excludeReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'bridge, staking or exchange category';
  if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked asset';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  return null;
}

/** Whether a protocol is one the early board may rank. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && excludeReason(p) === null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const catKey = (c: string | null): string => c ?? 'Uncategorized';
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clampTo = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const factorOf = (x: number): number => clampTo(x, FIT.factor_min, FIT.factor_max);

/** Median of numbers (0 when empty). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The fitted adjustments: Huber IRLS on centered features, so each factor is exp(coef x (x - mean)). */
export interface Fitted {
  /** [intercept, size, growth, maturity, chain]; the radar-2 fallback leaves it empty. */
  coef: number[];
  means: number[];
  fallback: boolean;
}

/** The comparables the model calibrates on: token-bearing protocols with TVL, as mcap/TVL. */
export interface Comparables {
  globalMedian: number;
  peerTotal: number;
  /** The 90th percentile (nearest-rank) of all peer ratios: no category multiple exceeds it. */
  cap: number;
  byCategory: Map<string, { n: number; median: number }>;
  /** Median mcap/TVL over all peers of one category family (kindOf). */
  byKind: Map<string, number>;
  growthByCategory: Map<string, number>;
  fit: Fitted;
}

const isPeer = (p: SnapshotProtocol): boolean => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;

/** Ratios, caps and growth medians from a set of peers (and the pre-token set, for the growth fallback); no fit yet. */
function baseComparables(peers: SnapshotProtocol[], all: SnapshotProtocol[]): Comparables {
  const ratios: number[] = [];
  const cats = new Map<string, number[]>();
  const kinds = new Map<string, number[]>();
  const growth = new Map<string, number[]>();
  for (const p of peers) {
    const r = p.mcap_usd! / p.tvl_usd;
    ratios.push(r);
    const k = catKey(p.category);
    (cats.get(k) ?? cats.set(k, []).get(k)!).push(r);
    const f = kindOfCategory(p.category);
    (kinds.get(f) ?? kinds.set(f, []).get(f)!).push(r);
  }
  for (const p of all) {
    if (isPreToken(p) && p.change_7d !== null) {
      const k = catKey(p.category);
      (growth.get(k) ?? growth.set(k, []).get(k)!).push(p.change_7d);
    }
  }
  const byCategory = new Map<string, { n: number; median: number }>();
  for (const [k, v] of cats) byCategory.set(k, { n: v.length, median: median(v) });
  const byKind = new Map<string, number>();
  for (const [k, v] of kinds) byKind.set(k, median(v));
  const growthByCategory = new Map<string, number>();
  for (const [k, v] of growth) growthByCategory.set(k, median(v));
  const sorted = [...ratios].sort((a, b) => a - b);
  const cap = sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(0.9 * sorted.length) - 1)]!;
  return { globalMedian: median(ratios), peerTotal: ratios.length, cap, byCategory, byKind, growthByCategory, fit: { coef: [], means: [], fallback: true } };
}

/** The shrunk category multiple: few category peers lean on the global median. */
export function peerMultiple(n: number, catMedian: number, globalMedian: number, model: ModelConstants = MODEL): number {
  return n >= 1 ? (n * catMedian + model.prior_weight * globalMedian) / (n + model.prior_weight) : globalMedian;
}

/** A category's multiple: shrunk to the global median, blended with its family when it has fewer than 3 peers, capped at p90. */
export function categoryMultiple(category: string | null, comps: Comparables, model: ModelConstants = MODEL): { pm: number; n: number } {
  const cat = comps.byCategory.get(catKey(category));
  const n = cat?.n ?? 0;
  let pm = peerMultiple(n, cat?.median ?? 0, comps.globalMedian, model);
  if (n < FIT.thin_peers) {
    const fam = comps.byKind.get(kindOfCategory(category));
    if (fam !== undefined) {
      const w = (FIT.thin_peers - n) / FIT.thin_peers;
      pm = w * fam + (1 - w) * pm;
    }
  }
  return { pm: Math.min(pm, comps.cap), n };
}

/** The raw features of one protocol: [ln tvl, clamped 7d change, ln age in years, ln chains]. */
function featuresOf(p: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants): number[] {
  const age = ageDays(asOf, p.listed_at) ?? model.unknown_age_days;
  const g = p.change_7d ?? comps.growthByCategory.get(catKey(p.category)) ?? 0;
  return [Math.log(Math.max(p.tvl_usd, 1)), clampTo(g, -FIT.growth_clamp, FIT.growth_clamp), Math.log(Math.max(age, FIT.min_age_days) / 365), Math.log(Math.max(p.chains.length, 1))];
}

/** Solve the augmented k x (k+1) system by Gaussian elimination with partial pivoting; null when singular or not finite. */
function solveAugmented(A: number[][]): number[] | null {
  const k = A.length;
  const scale = Math.max(...A.map((row, i) => Math.abs(row[i]!)), 1);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    if (Math.abs(A[piv]![c]!) < 1e-9 * scale) return null;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let j = c; j <= k; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  const x = A.map((row, i) => row[k]! / row[i]!);
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

/** (Weighted) least squares by the normal equations; null when the system is singular or not finite. */
export function ols(X: number[][], y: number[], w?: number[]): number[] | null {
  const k = X[0]?.length ?? 0;
  if (k === 0 || X.length <= k) return null;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    const row = X[r]!;
    const wr = w === undefined ? 1 : w[r]!;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i]![j]! += wr * row[i]! * row[j]!;
      A[i]![k]! += wr * row[i]! * y[r]!;
    }
  }
  return solveAugmented(A);
}

/** Huber IRLS: the OLS start, then exactly 25 weighted passes (delta = 1.345 x MAD of the residuals each pass; MAD 0 stops). */
export function huber(X: number[][], y: number[]): number[] | null {
  let beta = ols(X, y);
  if (beta === null) return null;
  for (let it = 0; it < FIT.huber_iters; it++) {
    const r = y.map((v, i) => v - X[i]!.reduce((s, x, j) => s + x * beta![j]!, 0));
    const m = median(r);
    const mad = median(r.map((v) => Math.abs(v - m)));
    if (mad === 0) break;
    const delta = FIT.huber_k * mad;
    const next = ols(X, y, r.map((v) => (Math.abs(v) <= delta ? 1 : delta / Math.abs(v))));
    if (next === null) break;
    beta = next;
  }
  return beta;
}

/** Fit the adjustments on a set of peers, with comps built from those same peers. A degenerate fit is the radar-2 fallback. */
function fitPeers(peers: SnapshotProtocol[], asOf: string, comps: Comparables, model: ModelConstants): Fitted {
  const fallback: Fitted = { coef: [], means: [], fallback: true };
  if (peers.length < FIT.min_fit_peers) return fallback;
  const F = peers.map((p) => featuresOf(p, asOf, comps, model));
  const means = [0, 1, 2, 3].map((j) => F.reduce((s, f) => s + f[j]!, 0) / F.length);
  const y = peers.map((p) => Math.log(p.mcap_usd! / (p.tvl_usd * categoryMultiple(p.category, comps, model).pm)));
  const beta = huber(F.map((f) => [1, ...f.map((v, j) => v - means[j]!)]), y);
  if (beta === null || y.some((v) => !Number.isFinite(v))) return fallback;
  return { coef: beta, means, fallback: false };
}

/** The five adjustment factors (base, size, growth, maturity, chain), each clamped to [0.5, 2], and the clamp that keeps their product in [0.5, 2]. */
function adjustments(p: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants): { base: number; size: number; growth: number; maturity: number; chain: number; clamp: number; total: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const fit = comps.fit;
  let parts: { base: number; size: number; growth: number; maturity: number; chain: number };
  if (!fit.fallback) {
    const f = featuresOf(p, asOf, comps, model);
    const at = (j: number): number => factorOf(Math.exp(fit.coef[j + 1]! * (f[j]! - fit.means[j]!)));
    parts = { base: factorOf(Math.exp(fit.coef[0]!)), size: at(0), growth: at(1), maturity: at(2), chain: at(3) };
  } else {
    // radar-2 constants
    const g = p.change_7d ?? comps.growthByCategory.get(catKey(p.category)) ?? 0;
    const ageUsed = Math.min(age ?? model.unknown_age_days, model.maturity_cap_days);
    parts = {
      base: 1,
      size: factorOf(p.tvl_usd > model.size_knee_usd ? 1 / (1 + model.size_slope * Math.log10(p.tvl_usd / model.size_knee_usd)) : 1),
      growth: factorOf(1 + (g >= 0 ? model.growth_up : model.growth_down) * Math.tanh(g / model.growth_scale)),
      maturity: factorOf(model.maturity_floor + model.maturity_range * (Math.log1p(ageUsed / model.maturity_scale_days) / Math.log1p(model.maturity_cap_days / model.maturity_scale_days))),
      chain: factorOf(1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_cap)),
    };
  }
  const product = parts.base * parts.size * parts.growth * parts.maturity * parts.chain;
  const total = factorOf(product);
  return { ...parts, clamp: total / product, total, age };
}

/** The comparables the model calibrates on, with the adjustments fitted on all peers. */
export function comparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const peers = snapshot.protocols.filter(isPeer);
  const comps = baseComparables(peers, snapshot.protocols);
  comps.fit = fitPeers(peers, snapshot.as_of, comps, model);
  return comps;
}

/** Empirical quantile with linear interpolation (0 when empty). */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Sum of a string's UTF-16 char codes: the fold key. */
const charSum = (t: string): number => {
  let n = 0;
  for (let i = 0; i < t.length; i++) n += t.charCodeAt(i);
  return n;
};

/** One out-of-sample prediction: the actual mcap, the category multiple alone and the full fitted model. */
interface Pred {
  p: SnapshotProtocol;
  baseV: number;
  fittedV: number;
}

/** Refit the multiples and the Huber fit on `train` alone, then predict every `test` peer. */
function predictOut(train: SnapshotProtocol[], test: SnapshotProtocol[], snapshot: Snapshot, model: ModelConstants): Pred[] {
  const comps = baseComparables(train, snapshot.protocols);
  comps.fit = fitPeers(train, snapshot.as_of, comps, model);
  return test.map((p) => {
    const baseV = p.tvl_usd * categoryMultiple(p.category, comps, model).pm;
    return { p, baseV, fittedV: baseV * adjustments(p, snapshot.as_of, comps, model).total };
  });
}

const absLogErr = (xs: Pred[], f: (x: Pred) => number): number => median(xs.map((x) => Math.abs(Math.log(x.p.mcap_usd! / f(x)))));

/** Validation: 5-fold CV and walk-forward, errors fitted vs category-only, the P25/P75 band and its walk-forward coverage. */
export function validate(snapshot: Snapshot, model: ModelConstants = MODEL): FitReport {
  const peers = snapshot.protocols.filter(isPeer).sort((a, b) => cmp(a.slug, b.slug));
  const oof: Pred[] = [];
  for (let f = 0; f < FIT.cv_folds; f++) {
    const train = peers.filter((p) => charSum(p.slug) % FIT.cv_folds !== f);
    const test = peers.filter((p) => charSum(p.slug) % FIT.cv_folds === f);
    if (train.length > 0 && test.length > 0) oof.push(...predictOut(train, test, snapshot, model));
  }
  oof.sort((a, b) => cmp(a.p.slug, b.p.slug));
  const resid = oof.map((x) => Math.log(x.p.mcap_usd! / x.fittedV));
  const q25 = Math.min(0, quantile(resid, FIT.band_lo));
  const q75 = Math.max(0, quantile(resid, FIT.band_hi));

  const dated = [...peers].sort((a, b) => cmp(a.listed_at ?? '', b.listed_at ?? '') || cmp(a.slug, b.slug));
  const nFit = Math.round(dated.length * FIT.walk_train_share);
  const wf = predictOut(dated.slice(0, nFit), dated.slice(nFit), snapshot, model);
  const inside = wf.filter((x) => x.p.mcap_usd! >= x.fittedV * Math.exp(q25) && x.p.mcap_usd! <= x.fittedV * Math.exp(q75)).length;
  const datedOnly = dated.filter((p) => p.listed_at !== null);

  const all = comparables(snapshot, model);
  const log10 = (v: number): number => Math.round((Math.log(v) / Math.LN10) * 1000) / 1000;
  return {
    fit_method: `huber-irls-${FIT.huber_iters}`,
    features: ['intercept', 'ln TVL', '7d change (clamped ±50)', 'ln age (years)', 'ln chains'],
    coefficients: all.fit.coef.map(round4),
    means: all.fit.means.map(round4),
    fallback: all.fit.fallback,
    peers_fit_all: all.peerTotal,
    error_fitted: round4(absLogErr(oof, (x) => x.fittedV)),
    error_median_only: round4(absLogErr(oof, (x) => x.baseV)),
    cv: { n: oof.length, fitted: round4(absLogErr(oof, (x) => x.fittedV)), baseline: round4(absLogErr(oof, (x) => x.baseV)), folds: FIT.cv_folds },
    walk: {
      n: wf.length,
      n_fit: nFit,
      fitted: round4(absLogErr(wf, (x) => x.fittedV)),
      baseline: round4(absLogErr(wf, (x) => x.baseV)),
      from: datedOnly[0]?.listed_at ?? '',
      to: datedOnly[datedOnly.length - 1]?.listed_at ?? '',
      undated: dated.length - datedOnly.length,
    },
    band: { q25: round4(q25), q75: round4(q75), coverage: round4(wf.length === 0 ? 0 : inside / wf.length), inside, n: wf.length },
    scatter: oof.map((x) => [log10(x.fittedV), log10(x.p.mcap_usd!)]),
  };
}

/** One protocol's implied value, the factors behind it, and the clamp (1 unless the combined [0.5, 2] clamp binds). */
export function impliedValue(p: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants = MODEL): { implied: number; breakdown: ModelBreakdown; clamp: number; base: number } {
  const { pm, n } = categoryMultiple(p.category, comps, model);
  const a = adjustments(p, asOf, comps, model);
  const base = p.tvl_usd * pm;
  const implied = Math.max(1, Math.round(base * a.total));
  return {
    implied,
    clamp: a.clamp,
    base,
    breakdown: {
      peer_multiple: round4(pm),
      peer_count: n,
      size_adj: round4(a.size),
      growth_adj: round4(a.growth),
      maturity_adj: round4(a.maturity),
      chain_adj: round4(a.chain),
      base_adj: round4(a.base),
      confidence: round4(n / (n + FIT.confidence_k)),
      age_days: a.age,
    },
  };
}

/** Protocols in scope for the launch propensity: the snapshot less the product types the board does not rank. */
export function oddsScope(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => excludeReason(p) === null);
}

interface ShareCounts {
  globalRate: number;
  byCategory: Map<string, { tokenized: number; pre_token: number }>;
}

/** Tokenized and pre-token counts per category over a set of protocols, and the global tokenized rate. */
function shareCounts(pop: SnapshotProtocol[]): ShareCounts {
  const byCategory = new Map<string, { tokenized: number; pre_token: number }>();
  let tok = 0;
  for (const p of pop) {
    const c = byCategory.get(catKey(p.category)) ?? { tokenized: 0, pre_token: 0 };
    if (isPreToken(p)) c.pre_token++; else { c.tokenized++; tok++; }
    byCategory.set(catKey(p.category), c);
  }
  return { globalRate: pop.length === 0 ? 0.5 : tok / pop.length, byCategory };
}

/** A category's tokenized share, shrunk toward the global rate; `self` removes the protocol's own record (leave-one-out). */
function shrunkShare(sc: ShareCounts, category: string | null, self: SnapshotProtocol | null): number {
  const c = sc.byCategory.get(catKey(category)) ?? { tokenized: 0, pre_token: 0 };
  let tok = c.tokenized;
  let n = c.tokenized + c.pre_token;
  if (self !== null) { n--; if (!isPreToken(self)) tok--; }
  return (tok + FIT.odds_smoothing * sc.globalRate) / (n + FIT.odds_smoothing);
}

/** Per-category launch basis over the scope: tokenized vs pre-token counts and the shrunk share. */
export function launchOdds(snapshot: Snapshot): { globalRate: number; byCategory: Map<string, OddsRow> } {
  const sc = shareCounts(oddsScope(snapshot));
  const byCategory = new Map<string, OddsRow>();
  for (const [category, c] of sc.byCategory) {
    byCategory.set(category, { category, tokenized: c.tokenized, pre_token: c.pre_token, odds: round4(shrunkShare(sc, category, null)) });
  }
  return { globalRate: sc.globalRate, byCategory };
}

/** A fitted launch propensity: logistic weights over [1, category share, z ln TVL, ln chains, ln age (years)]. */
export interface Propensity {
  coef: number[];
  zMean: number;
  zSd: number;
  counts: ShareCounts;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-clampTo(z, -35, 35)));

function propFeatures(p: SnapshotProtocol, asOf: string, pr: { zMean: number; zSd: number; counts: ShareCounts }, self: SnapshotProtocol | null): number[] {
  const age = ageDays(asOf, p.listed_at) ?? MODEL.unknown_age_days;
  return [1, shrunkShare(pr.counts, p.category, self), (Math.log(Math.max(p.tvl_usd, 1)) - pr.zMean) / pr.zSd, Math.log(Math.max(p.chains.length, 1)), Math.log(Math.max(age, FIT.min_age_days) / 365)];
}

/** Fit the propensity on `train`: L2 (lambda on non-intercept weights), Newton, exactly 50 iterations from zero. */
export function fitPropensity(train: SnapshotProtocol[], asOf: string): Propensity {
  const counts = shareCounts(train);
  const lt = train.map((p) => Math.log(Math.max(p.tvl_usd, 1)));
  const zMean = lt.reduce((s, v) => s + v, 0) / Math.max(lt.length, 1);
  const zSd = Math.sqrt(lt.reduce((s, v) => s + (v - zMean) ** 2, 0) / Math.max(lt.length, 1)) || 1;
  const pr = { zMean, zSd, counts };
  const X = train.map((p) => propFeatures(p, asOf, pr, p));
  const y = train.map((p) => (isPreToken(p) ? 0 : 1));
  const k = 5;
  let beta = new Array<number>(k).fill(0);
  for (let it = 0; it < FIT.logit_iters; it++) {
    const g = new Array<number>(k).fill(0);
    const A: number[][] = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
    for (let r = 0; r < X.length; r++) {
      const x = X[r]!;
      const pi = sigmoid(x.reduce((s, v, j) => s + v * beta[j]!, 0));
      const w = pi * (1 - pi);
      for (let i = 0; i < k; i++) {
        g[i]! += x[i]! * (pi - y[r]!);
        for (let j = 0; j < k; j++) A[i]![j]! += w * x[i]! * x[j]!;
      }
    }
    for (let i = 0; i < k; i++) {
      if (i > 0) { g[i]! += FIT.logit_lambda * beta[i]!; A[i]![i]! += FIT.logit_lambda; }
      A[i]![i]! += FIT.logit_ridge;
      A[i]![k] = g[i]!;
    }
    const step = solveAugmented(A);
    if (step === null) break;
    beta = beta.map((b, i) => b - step[i]!);
  }
  return { coef: beta, zMean, zSd, counts };
}

/** The fitted propensity for one protocol, before clamping; `inScope` removes its own record from its category share. */
export function propensityOf(p: SnapshotProtocol, asOf: string, pr: Propensity, inScope: boolean): number {
  return sigmoid(propFeatures(p, asOf, pr, inScope ? p : null).reduce((s, v, j) => s + v * pr.coef[j]!, 0));
}

const oddsClamp = (v: number): number => round4(clampTo(v, FIT.odds_min, FIT.odds_max));

/** The propensity's report: the all-scope fit, and Brier on the held half of a slug-parity split against the base rate. */
export function oddsReport(snapshot: Snapshot, pr: Propensity): OddsReport {
  const scope = oddsScope(snapshot).sort((a, b) => cmp(a.slug, b.slug));
  const train = scope.filter((_, i) => i % 2 === 0);
  const test = scope.filter((_, i) => i % 2 === 1);
  const half = fitPropensity(train, snapshot.as_of);
  const rate = shareCounts(train).globalRate;
  const brier = (f: (p: SnapshotProtocol) => number): number => test.reduce((s, p) => s + (f(p) - (isPreToken(p) ? 0 : 1)) ** 2, 0) / Math.max(test.length, 1);
  const lo = launchOdds(snapshot);
  return {
    global_rate: round4(lo.globalRate),
    smoothing: FIT.odds_smoothing,
    categories: [...lo.byCategory.values()].sort((a, b) => b.tokenized + b.pre_token - (a.tokenized + a.pre_token) || cmp(a.category, b.category)),
    features: ['intercept', 'category tokenized share', 'ln TVL (z)', 'ln chains', 'ln age (years)'],
    coefficients: pr.coef.map(round4),
    lambda: FIT.logit_lambda,
    iterations: FIT.logit_iters,
    n_scope: scope.length,
    n_train: train.length,
    n_test: test.length,
    brier_propensity: round4(brier((p) => clampTo(propensityOf(p, snapshot.as_of, half, false), FIT.odds_min, FIT.odds_max))),
    brier_base: round4(brier(() => rate)),
  };
}

/** Chain cost tiers: a COST ASSUMPTION of this model, not a measurement. Round-trip bridge plus gas, in dollars, per chain used. */
export const CHAIN_TIERS: { tier: string; label: string; cost_usd: number }[] = [
  { tier: 'A', label: 'Ethereum', cost_usd: 85 },
  { tier: 'B', label: 'other layer-1', cost_usd: 18 },
  { tier: 'C', label: 'layer-2 or rollup', cost_usd: 4 },
  { tier: 'U', label: 'chain not in the table', cost_usd: 12 },
];
const TIER_COST = new Map(CHAIN_TIERS.map((t) => [t.tier, t.cost_usd]));
// The chain -> tier lookup is part of the same assumption: DefiLlama's chain names, sorted by how each chain is built.
const TIER_C = new Set(['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Starknet', 'Polygon zkEVM', 'Manta', 'Mode', 'Ink', 'Unichain', 'Fraxtal', 'Metis', 'Taiko', 'Zora', 'Lisk', 'Soneium', 'BOB', 'Abstract', 'World Chain', 'Katana', 'X Layer', 'Robinhood Chain', 'Arbitrum Nova', 'opBNB', 'Zircuit', 'Swellchain', 'Redstone', 'Boba', 'Cyber', 'Hemi']);
const TIER_B = new Set(['Solana', 'Binance', 'Avalanche', 'Polygon', 'Bitcoin', 'Hyperliquid L1', 'Monad', 'Tron', 'Plasma', 'Sonic', 'Sui', 'Ripple', 'Fantom', 'Berachain', 'xDai', 'Arc', 'Celo', 'Cardano', 'TON', 'Sei', 'Flare', 'Stellar', 'Doge', 'Litecoin', 'Near', 'Aptos', 'Kava', 'Cronos', 'Moonbeam', 'Plume Mainnet', 'RSK', 'Klaytn', 'Algorand', 'Moonriver', 'Polkadot', 'Aurora', 'CORE', 'Hedera', 'Injective', 'Osmosis', 'Cosmos', 'Terra2', 'Gnosis']);

/** A chain's cost tier: A Ethereum, B other layer-1, C layer-2 or rollup, U unknown. */
export function chainTier(chain: string): string {
  if (chain === 'Ethereum') return 'A';
  if (TIER_C.has(chain)) return 'C';
  if (TIER_B.has(chain)) return 'B';
  return 'U';
}

/** Dilution: wallets assumed to farm a protocol, scaled by its TVL. */
export const DILUTION = { base: 1200, ref_tvl_usd: 50_000_000, exponent: 0.45, min: 300, max: 30_000 };
/** Deposit: the farm position, scaled by TVL, in whole tens of dollars. */
export const DEPOSIT = { rate: 0.00002, step: 10, min: 250, max: 10_000 };
/** One qualifying action costs this share of the primary chain's round-trip figure. */
export const ACTION_FEE_SHARE = 0.1;
/** A farm plan names at most this many of the protocol's first chains. */
export const MAX_PLAN_CHAINS = 3;

export function participantsFor(tvl: number): number {
  return clampTo(Math.round(DILUTION.base * Math.pow(Math.max(tvl, 0) / DILUTION.ref_tvl_usd, DILUTION.exponent)), DILUTION.min, DILUTION.max);
}

export function depositFor(tvl: number): number {
  return clampTo(Math.round((Math.max(tvl, 0) * DEPOSIT.rate) / DEPOSIT.step) * DEPOSIT.step, DEPOSIT.min, DEPOSIT.max);
}

const usd = (n: number): string => (n >= 10 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`);

/** Farm totals and the costed verdict for one row: expected airdrop per wallet against the all-in cost. */
export function farmVerdict(steps: FarmStep[], ev: number, riskAdjusted: number, participants: number): { cost: number; hours: number; verdict: string } {
  const cost = Math.round(steps.reduce((s, x) => s + x.cost_usd, 0) * 100) / 100;
  const hours = Math.round(steps.reduce((s, x) => s + x.hours, 0) * 100) / 100;
  const allIn = cost + hours * FIT.hour_value_usd;
  const ratio = ev / allIn;
  const label = ratio >= FIT.worth_ratio ? 'Worth it' : ratio >= FIT.marginal_ratio ? 'Marginal' : 'Skip';
  const verdict = `${label}: expected ${usd(ev)} a wallet (risk-adjusted ${usd(riskAdjusted)} x ${FIT.airdrop_pool_share * 100}% pool / ${participants.toLocaleString('en-US')} wallets) vs all-in ${usd(allIn)} (${usd(cost)} fees + ${hours.toFixed(1)}h x $${FIT.hour_value_usd}), ${ratio.toFixed(2)}x.`;
  return { cost, hours, verdict };
}

/** FNV-1a (32-bit) of a string's UTF-8 bytes, as 8 hex digits. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** What the dashboard shows beside a board row and the board itself does not carry. */
export type RowExtras = Pick<RadarRow, 'value_low' | 'value_high' | 'cat_share' | 'clamp_adj' | 'waterfall' | 'nearest' | 'plan'>;

/** Up to 3 tokenized peers of the same category, nearest in TVL (|ln of the ratio|), ties by slug. */
export function nearestPeers(p: SnapshotProtocol, peers: SnapshotProtocol[]): NearPeer[] {
  const key = catKey(p.category);
  const lt = Math.log(Math.max(p.tvl_usd, 1));
  return peers
    .filter((q) => catKey(q.category) === key)
    .map((q) => ({ q, d: Math.abs(Math.log(q.tvl_usd) - lt) }))
    .sort((a, b) => a.d - b.d || cmp(a.q.slug, b.q.slug))
    .slice(0, 3)
    .map(({ q }) => ({ name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd!, multiple: round4(q.mcap_usd! / q.tvl_usd) }));
}

/** The board and, per slug, the extras only the dashboard shows. `validation` and `prop` are the fits to score with. */
function scoreBoard(snapshot: Snapshot, model: ModelConstants, validation: FitReport, prop: Propensity): { board: BoardRow[]; extras: Map<string, RowExtras> } {
  const comps = comparables(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const peers = snapshot.protocols.filter(isPeer);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const score = (p: SnapshotProtocol) => ({ p, ...impliedValue(p, snapshot.as_of, comps, model) });
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isRankable(p))
    .map(score)
    .sort((a, b) => b.implied - a.implied || cmp(a.p.slug, b.p.slug))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map(score);
  scored.sort((a, b) => b.implied - a.implied || cmp(a.p.slug, b.p.slug));
  const extras = new Map<string, RowExtras>();
  const board = scored.map((s, i) => {
    const inScope = excludeReason(s.p) === null;
    const launch = oddsClamp(propensityOf(s.p, snapshot.as_of, prop, inScope));
    const c = prop.counts.byCategory.get(catKey(s.p.category));
    const risk = Math.round(s.implied * launch);
    const plan = farmPlan(s.p, s.breakdown.age_days);
    const ev = (s.implied * launch * FIT.airdrop_pool_share) / plan.participants;
    const fv = farmVerdict(plan.steps, ev, risk, plan.participants);
    const m = s.breakdown;
    let v = s.base;
    const wf: [string, number | null, number][] = [['Base value: TVL x peer multiple', null, Math.round(v)]];
    for (const [label, f] of [['Fitted base', m.base_adj], ['Size', m.size_adj], ['Growth', m.growth_adj], ['Maturity', m.maturity_adj], ['Chains', m.chain_adj], ['Combined clamp', round4(s.clamp)]] as [string, number][]) {
      if (label === 'Combined clamp' && f === 1) continue;
      v *= f;
      wf.push([label, f, Math.round(v)]);
    }
    wf.push(['Implied value', null, s.implied]);
    extras.set(s.p.slug, {
      value_low: Math.max(1, Math.min(s.implied, Math.round(s.implied * Math.exp(validation.band.q25)))),
      value_high: Math.max(s.implied, Math.round(s.implied * Math.exp(validation.band.q75))),
      cat_share: round4(shrunkShare(prop.counts, s.p.category, inScope ? s.p : null)),
      clamp_adj: round4(s.clamp),
      waterfall: wf,
      nearest: nearestPeers(s.p, peers),
      plan: { participants: plan.participants, deposit_usd: plan.deposit, ev_wallet_usd: Math.round(ev * 100) / 100, chains: plan.chains, chain_cost_usd: plan.chain_cost },
    });
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.breakdown.age_days,
      watchlist: watch.has(s.p.slug),
      implied_value_usd: s.implied,
      launch_odds: launch,
      risk_adjusted_usd: risk,
      launch_basis: { tokenized: c?.tokenized ?? 0, pre_token: c?.pre_token ?? 0 },
      model: s.breakdown,
      farm_steps: plan.steps.map(stepText),
      farm_cost_usd: fv.cost,
      farm_hours: fv.hours,
      farm_verdict: fv.verdict,
    };
  });
  return { board, extras };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  return scoreBoard(snapshot, model, validate(snapshot, model), fitPropensity(oddsScope(snapshot), snapshot.as_of)).board;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Hold time by age: younger protocols get a longer window; established ones a sustained eight weeks. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age > 4 * 365) return 56;
  return 30;
}

type CategoryKind = 'lending' | 'cdp' | 'dex' | 'derivatives' | 'bridge' | 'curator' | 'yield' | 'rwa' | 'stablecoin' | 'insurance' | 'staking' | 'basis' | 'launchpad' | 'other';

/** The category's family, from its name; the order settles the overlaps (Yield Aggregator is yield). */
function kindOf(p: SnapshotProtocol): CategoryKind {
  return kindOfCategory(p.category);
}

/** The family of a category name. */
export function kindOfCategory(category: string | null): CategoryKind {
  const c = (category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('cdp')) return 'cdp';
  if (c.includes('lend') || c.includes('collateral')) return 'lending';
  if (c.includes('basis')) return 'basis';
  if (c.includes('dex')) return 'dex';
  if (c.includes('perp') || c.includes('derivative') || c.includes('option')) return 'derivatives';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('rwa') || c.includes('real world')) return 'rwa';
  if (c.includes('stable')) return 'stablecoin';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('launchpad')) return 'launchpad';
  return 'other';
}

/** The category's main action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const n = p.name;
  switch (kindOf(p)) {
    case 'lending': return `Supply $${capital} of USDC to ${n} on ${chain} and keep the position open.`;
    case 'cdp': return `Deposit $${capital} of the accepted collateral into ${n} on ${chain} and keep the vault open.`;
    case 'dex': return `Provide $${capital} of liquidity to ${n}'s main pool on ${chain} and keep the position open.`;
    case 'derivatives': return `Deposit $${capital} of USDC as margin on ${n} on ${chain}.`;
    case 'bridge': return `Bridge $${capital} of USDC to ${chain} through ${n} and use the bridged funds in its app.`;
    case 'curator': return `Deposit $${capital} into a ${n} vault on ${chain} and keep the shares.`;
    case 'yield': return `Deposit $${capital} into ${n}'s highest-TVL vault on ${chain} and keep the receipt.`;
    case 'rwa': return `Mint $${capital} of ${n}'s yield asset on ${chain} and hold it.`;
    case 'stablecoin': return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain}.`;
    case 'insurance': return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy.`;
    case 'staking': return `Stake $${capital} of the supported asset in ${n} on ${chain} and keep the receipt.`;
    case 'basis': return `Deposit $${capital} of USDC into ${n}'s basis vault on ${chain} and keep the shares.`;
    case 'launchpad': return `Commit $${capital} to one live sale on ${n} on ${chain} and keep the allocation.`;
    default: return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
  }
}

/** The second, category-specific qualifying action. */
function secondFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const small = Math.max(10, Math.round(capital / 10));
  switch (kindOf(p)) {
    case 'lending': return `Borrow a small amount, about $${small}, against the supply on ${chain}, then repay it in full.`;
    case 'cdp': return `Mint about $${small} of the stable asset against the collateral, keeping the ratio well above the minimum, then repay it.`;
    case 'dex': return `Make 4 to 5 swaps of about $${small} each through the main pool on ${chain}, in both directions.`;
    case 'derivatives': return `Open one small hedged position of about $${small}, long and short offsetting, then close it.`;
    case 'bridge': return `Bridge about $${small} back to the origin chain once, to count a round trip.`;
    case 'curator': return `Deposit about $${small * 2} into a second vault as well, so two vaults carry your activity.`;
    case 'yield': return `Claim or compound the accrued yield once, to record a harvest transaction.`;
    case 'rwa': return `Complete the issuer's eligibility check, then mint the asset with the whitelisted wallet.`;
    case 'basis': return `Withdraw a small slice, about $${small}, and redeposit it, to record both directions.`;
    default: return `Vote or stake a small amount, about $${small}, if the protocol offers it.`;
  }
}

/** The category's risk, named, with the exit. */
function riskFor(p: SnapshotProtocol): string {
  switch (kindOf(p)) {
    case 'lending':
    case 'cdp': return `Risk: liquidation if the collateral falls, so keep the loan small and watch the ratio.`;
    case 'dex':
    case 'yield': return `Risk: impermanent loss in a liquidity pool, and the vault's smart-contract risk.`;
    case 'bridge': return `Risk: bridge contract risk, so never leave more than the stake in transit.`;
    case 'staking': return `Risk: slashing and unstaking delay.`;
    case 'derivatives': return `Risk: funding costs and liquidation, so use no leverage.`;
    case 'rwa': return `Risk: issuer and redemption terms, so read the redemption window first.`;
    default: return `Risk: smart-contract risk, so size the position as money you can lose.`;
  }
}

const joinList = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** A protocol's farm plan, derived from its own record (category, first chains, TVL, 7d change, age). */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: FarmStep[]; participants: number; deposit: number; chains: PlanFigures['chains']; chain_cost: number } {
  const named = p.chains.slice(0, MAX_PLAN_CHAINS);
  const chains = (named.length > 0 ? named : ['its main chain']).map((name) => {
    const tier = named.length > 0 ? chainTier(name) : 'U';
    return { name, tier, cost_usd: TIER_COST.get(tier)! };
  });
  const chain = chains[0]!;
  const chainCost = chains.reduce((s, c) => s + c.cost_usd, 0);
  const n = chains.length;
  const participants = participantsFor(p.tvl_usd);
  const deposit = depositFor(p.tvl_usd);
  const fee = Math.round(chain.cost_usd * ACTION_FEE_SHARE * 100) / 100;
  const g = p.change_7d;
  let hold = holdDaysFor(age);
  if (g !== null && g > 5) hold = Math.min(hold, 21);
  const weeks = Math.ceil(hold / 7);

  const cadence =
    age !== null && age < 365
      ? `Listed ${age} days ago, so build an early-user footprint on ${chain.name}: one small action a week for ${weeks} weeks, kept cheap at about ${usd(fee)} each.`
      : age !== null && age > 4 * 365
        ? `Listed ${(age / 365).toFixed(1)} years ago, an established protocol, so show a sustained cadence on ${chain.name}: one qualifying action a week for ${weeks} weeks, on different weekdays, at about ${usd(fee)} each.`
        : `Make one qualifying action each week on ${chain.name}, such as a deposit, a swap or a vote, for ${weeks} weeks, so the wallet shows steady use.`;
  const holdText =
    g !== null && g > 5
      ? `Its TVL rose ${g.toFixed(1)}% in 7 days, so farmers are crowding in: keep the position at $${deposit}, add no leverage, and hold a shorter ${hold} days instead of chasing the surge.`
      : g !== null && g < -5
        ? `Its TVL fell ${Math.abs(g).toFixed(1)}% in 7 days while attention is low: accumulate quietly, adding the $${deposit} in two halves a few days apart, and hold for at least ${hold} days.`
        : `Hold the $${deposit} position for at least ${hold} days, so the activity is counted across more than one snapshot.`;

  const steps: FarmStep[] = [
    { text: `Create a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, offline.`, cost: 'no fee', time: '5 minutes', cost_usd: 0, hours: 5 / 60 },
    {
      text: `Fund the wallet on ${joinList(chains.map((c) => c.name))}: ${chains.map((c) => `${c.name} is tier ${c.tier} at ${usd(c.cost_usd)}`).join('; ')} for the round trip of bridging and gas.`,
      cost: `${usd(chainCost)} for ${n} chain${n === 1 ? '' : 's'}, round trip`,
      time: `${15 * n} minutes`,
      cost_usd: chainCost,
      hours: (15 * n) / 60,
    },
    { text: actionFor(p, deposit, chain.name), cost: `$${deposit} of capital, returned on exit, and about ${usd(fee)} of gas`, time: '15 minutes', cost_usd: fee, hours: 15 / 60 },
    { text: secondFor(p, deposit, chain.name), cost: `about ${usd(fee)} of gas`, time: '10 minutes', cost_usd: fee, hours: 10 / 60 },
    { text: cadence, cost: `about ${usd(fee)} a week`, time: '10 min/week', cost_usd: fee * weeks, hours: (10 * weeks) / 60 },
    { text: holdText, cost: `the $${deposit} stays in the position`, time: `${hold} days`, cost_usd: 0, hours: 0 },
    { text: `Check the protocol's own points or rewards page, and claim only from the link that page publishes. Never pay to claim. At ${usd(p.tvl_usd)} TVL this plan assumes about ${participants.toLocaleString('en-US')} wallets share the pool.`, cost: 'no fee to check', time: '10 minutes', cost_usd: 0, hours: 10 / 60 },
    { text: `${riskFor(p)} Record the wallet, dates and every transaction in a farm log, then withdraw, unwind and bridge back from ${joinList(chains.map((c) => c.name))}.`, cost: 'bridge-back is in the round-trip figure', time: `${20 + 5 * (n - 1)} minutes`, cost_usd: 0, hours: (20 + 5 * (n - 1)) / 60 },
  ];
  return { steps, participants, deposit, chains, chain_cost: chainCost };
}

/** The live-token protocols, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || cmp(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** A board row's form for data.js: the row plus the extras only the dashboard shows. */
export function radarRow(row: BoardRow, extra: RowExtras): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    launch_odds: row.launch_odds,
    risk_adjusted_usd: row.risk_adjusted_usd,
    launch_basis: row.launch_basis,
    model: row.model,
    farm_steps: row.farm_steps,
    farm_cost_usd: row.farm_cost_usd,
    farm_hours: row.farm_hours,
    farm_verdict: row.farm_verdict,
    ...extra,
  };
}

/** A disposition for every protocol, in priority order: tokenized, on the board, excluded product type, other pre-token. */
export function coverage(snapshot: Snapshot, board: BoardRow[]): Coverage {
  const onBoard = new Set(board.map((r) => r.slug));
  const reasons: Record<string, number> = {};
  let tokenized = 0;
  let ranked = 0;
  let excluded = 0;
  let other = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) tokenized++;
    else if (onBoard.has(p.slug)) ranked++;
    else {
      const why = excludeReason(p);
      if (why !== null) { excluded++; reasons[why] = (reasons[why] ?? 0) + 1; } else other++;
    }
  }
  const sortedReasons: Record<string, number> = {};
  for (const k of Object.keys(reasons).sort(cmp)) sortedReasons[k] = reasons[k]!;
  return { total: snapshot.protocols.length, tokenized, ranked, excluded, excluded_reasons: sortedReasons, other_pre_token: other, floor_usd: snapshot.floor_usd, as_of: snapshot.as_of };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const validation = validate(snapshot, model);
  const prop = fitPropensity(oddsScope(snapshot), snapshot.as_of);
  const { board, extras } = scoreBoard(snapshot, model, validation, prop);
  const live = liveRows(snapshot);
  const comps = comparables(snapshot, model);
  const peers: PeerRow[] = [...comps.byCategory]
    .map(([category, v]) => ({ category, n: v.n, median_multiple: round4(v.median), multiple: round4(categoryMultiple(category, comps, model).pm) }))
    .sort((a, b) => b.n - a.n || cmp(a.category, b.category));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    // Generated data carries no web address: the source's URL is cut to its endpoint path.
    source: snapshot.source.replace(/https?:\/\/[^\s,]+/g, (u) => { try { return new URL(u).pathname; } catch { return ''; } }),
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    protocols_scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    global_median_multiple: round4(comps.globalMedian),
    peer_cap_multiple: round4(comps.cap),
    peer_total: comps.peerTotal,
    rows: board.map((r) => radarRow(r, extras.get(r.slug)!)),
    live,
    peers,
    fit: validation,
    coverage: coverage(snapshot, board),
    odds: oddsReport(snapshot, prop),
    farm: {
      airdrop_pool_share: FIT.airdrop_pool_share,
      hour_value_usd: FIT.hour_value_usd,
      worth_ratio: FIT.worth_ratio,
      marginal_ratio: FIT.marginal_ratio,
      tiers: CHAIN_TIERS,
      dilution: DILUTION,
      deposit: DEPOSIT,
      action_fee_share: ACTION_FEE_SHARE,
      max_chains: MAX_PLAN_CHAINS,
    },
    recon: { rows: board.length, sum_implied_usd: board.reduce((t, r) => t + r.implied_value_usd, 0), build: fnv1a(board.map((r) => r.slug + r.implied_value_usd).join('')) },
  };
  return { board, radar };
}

/** The calibration in a few lines: model, peers, out-of-sample errors (5-fold and walk-forward), band coverage and Brier. */
export function calibrationSummary(radar: RadarData): string {
  const f = radar.fit;
  const o = radar.odds;
  const fitText = f.fallback ? 'fit degenerate, radar-2 constants used' : `${f.fit_method} coefficients [${f.coefficients.join(', ')}] (${f.features.join(', ')})`;
  return (
    `model ${radar.model_version}, ${radar.peer_total} peers, global median x${radar.global_median_multiple}, cap x${radar.peer_cap_multiple}; ${fitText}\n` +
    `token radar: ${f.cv.folds}-fold OOF median abs log error ${f.cv.fitted} fitted vs ${f.cv.baseline} category-only (${f.cv.n} peers); walk-forward ${f.walk.fitted} fitted vs ${f.walk.baseline} category-only (${f.walk.n_fit} fit / ${f.walk.n} test, ${f.walk.undated} undated counted oldest)\n` +
    `token radar: band P25/P75 of OOF residual ${f.band.q25}/${f.band.q75}, walk-forward coverage ${(f.band.coverage * 100).toFixed(1)}% (${f.band.inside}/${f.band.n}); propensity Brier ${o.brier_propensity} vs base rate ${o.brier_base} (${o.n_train} fit / ${o.n_test} held, scope ${o.n_scope})`
  );
}

/** The coverage in one line: every protocol accounted for. */
export function coverageSummary(radar: RadarData): string {
  const c = radar.coverage;
  const why = Object.entries(c.excluded_reasons).map(([k, v]) => `${v} ${k}`).join(', ');
  return `coverage ${c.total} = ${c.ranked} ranked + ${c.tokenized} tokenized + ${c.excluded} excluded as product type (${why}) + ${c.other_pre_token} other pre-token not ranked (floor $${c.floor_usd.toLocaleString('en-US')}, as of ${c.as_of})`;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const m = r.model;
    if (![m.peer_multiple, m.size_adj, m.growth_adj, m.maturity_adj, m.chain_adj, m.base_adj, m.confidence].every((x) => Number.isFinite(x))) return `${r.slug} has a non-finite model factor`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.launch_odds >= FIT.odds_min && r.launch_odds <= FIT.odds_max)) return `${r.slug} has launch odds ${r.launch_odds}`;
    if (!Number.isSafeInteger(r.risk_adjusted_usd) || r.risk_adjusted_usd < 0) return `${r.slug} has risk-adjusted value ${r.risk_adjusted_usd}`;
    if (!Number.isFinite(r.farm_cost_usd) || !Number.isFinite(r.farm_hours) || r.farm_verdict.length === 0) return `${r.slug} has no farm verdict`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
