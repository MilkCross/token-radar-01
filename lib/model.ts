// The token radar's model (radar-3): one snapshot of the protocol universe in, one ranked board out.
//
// A protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id, no
// symbol). Implied value is calibrated on the snapshot's own token-bearing protocols (the peers):
//
//   ratio          = mcap / tvl, for every protocol with a market cap and TVL above zero
//   cap            = p90 of all peer ratios (nearest-rank); peerMultiple = min(shrunk, cap)
//   peerMultiple   = (n x categoryMedian + 8 x globalMedian) / (n + 8)   (n = peers in the category)
//   sizeAdj        = 1 / (1 + 0.07 x log10(tvl / 10M)) above $10M TVL, else 1
//   growthAdj      = 1 + (0.30 up | 0.45 down) x tanh(g / 25), g = 7d TVL change, else category median
//   maturityAdj    = 0.75 + 0.45 x log1p(age / 90) / log1p(1095 / 90)
//   chainAdj       = 1 + 0.02 x min(chains - 1, 7)
//   implied        = max(1, round(tvl x peerMultiple x baseAdj x sizeAdj x growthAdj x maturityAdj x chainAdj))
//
// radar-3 fits the adjustments instead of hand-setting them. An OLS regression over the peers (normal
// equations, deterministic) explains log(mcap / (tvl x categoryMultiple)) from [ln tvl, clamped 7d change,
// ln age in years, ln chain count]; each factor is exp(coefficient x (feature - peer mean)), clamped to
// [0.5, 2], and baseAdj is exp(intercept). A degenerate fit falls back to the radar-2 constants above.
// Held out: peers sorted by slug, even indices fit, odd indices test; the report is the median absolute
// log error on the test half for the category multiple alone versus the full fitted model.
// A category with fewer than 3 peers blends in its family's multiple (weight (3 - n) / 3). Launch odds per
// category come from tokenized vs pre-token counts among protocols with TVL >= $1M, smoothed to the global rate.
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

export const MODEL_VERSION = 'radar-3';

/** radar-3 fixed choices: the dashboard states them. */
export const FIT = {
  thin_peers: 3,
  confidence_k: 8,
  factor_min: 0.5,
  factor_max: 2,
  growth_clamp: 50,
  min_age_days: 7,
  min_fit_peers: 12,
  odds_min_tvl_usd: 1_000_000,
  odds_smoothing: 4,
  odds_min: 0.02,
  odds_max: 0.98,
  airdrop_pool_share: 0.05,
  airdrop_wallets: 2500,
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
  odds: { global_rate: number; smoothing: number; min_tvl_usd: number; categories: OddsRow[] };
  farm: { airdrop_pool_share: number; airdrop_wallets: number; airdrop_share: number; hour_value_usd: number; worth_ratio: number; marginal_ratio: number };
}

/** The fit and its held-out check, as the dashboard shows them. */
export interface FitReport {
  features: string[];
  coefficients: number[];
  means: number[];
  fallback: boolean;
  peers_fit_all: number;
  peers_fit_half: number;
  peers_test_half: number;
  error_median_only: number;
  error_fitted: number;
  half_coefficients: number[];
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

/** The fitted adjustments: OLS on centered features, so each factor is exp(coef x (x - mean)). */
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

/** Least squares by the normal equations and Gaussian elimination; null when the system is singular or not finite. */
export function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0]?.length ?? 0;
  if (k === 0 || X.length <= k) return null;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    const row = X[r]!;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i]![j]! += row[i]! * row[j]!;
      A[i]![k]! += row[i]! * y[r]!;
    }
  }
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
  const beta = A.map((row, i) => row[k]! / row[i]!);
  return beta.every((b) => Number.isFinite(b)) ? beta : null;
}

/** Fit the adjustments on a set of peers, with comps built from those same peers. A degenerate fit is the radar-2 fallback. */
function fitPeers(peers: SnapshotProtocol[], asOf: string, comps: Comparables, model: ModelConstants): Fitted {
  const fallback: Fitted = { coef: [], means: [], fallback: true };
  if (peers.length < FIT.min_fit_peers) return fallback;
  const F = peers.map((p) => featuresOf(p, asOf, comps, model));
  const means = [0, 1, 2, 3].map((j) => F.reduce((s, f) => s + f[j]!, 0) / F.length);
  const y = peers.map((p) => Math.log(p.mcap_usd! / (p.tvl_usd * categoryMultiple(p.category, comps, model).pm)));
  const beta = ols(F.map((f) => [1, ...f.map((v, j) => v - means[j]!)]), y);
  if (beta === null || y.some((v) => !Number.isFinite(v))) return fallback;
  return { coef: beta, means, fallback: false };
}

/** The five adjustment factors (base, size, growth, maturity, chain), each clamped to [0.5, 2]. */
function adjustments(p: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants): { base: number; size: number; growth: number; maturity: number; chain: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const fit = comps.fit;
  if (!fit.fallback) {
    const f = featuresOf(p, asOf, comps, model);
    const at = (j: number): number => factorOf(Math.exp(fit.coef[j + 1]! * (f[j]! - fit.means[j]!)));
    return { base: factorOf(Math.exp(fit.coef[0]!)), size: at(0), growth: at(1), maturity: at(2), chain: at(3), age };
  }
  // radar-2 constants
  const g = p.change_7d ?? comps.growthByCategory.get(catKey(p.category)) ?? 0;
  const ageUsed = Math.min(age ?? model.unknown_age_days, model.maturity_cap_days);
  return {
    base: 1,
    size: factorOf(p.tvl_usd > model.size_knee_usd ? 1 / (1 + model.size_slope * Math.log10(p.tvl_usd / model.size_knee_usd)) : 1),
    growth: factorOf(1 + (g >= 0 ? model.growth_up : model.growth_down) * Math.tanh(g / model.growth_scale)),
    maturity: factorOf(model.maturity_floor + model.maturity_range * (Math.log1p(ageUsed / model.maturity_scale_days) / Math.log1p(model.maturity_cap_days / model.maturity_scale_days))),
    chain: factorOf(1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_cap)),
    age,
  };
}

/** The comparables the model calibrates on, with the adjustments fitted on all peers. */
export function comparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const peers = snapshot.protocols.filter(isPeer);
  const comps = baseComparables(peers, snapshot.protocols);
  comps.fit = fitPeers(peers, snapshot.as_of, comps, model);
  return comps;
}

/** Held-out check: peers by slug, even indices fit, odd indices test; median absolute log error on the test half. */
export function validate(snapshot: Snapshot, model: ModelConstants = MODEL): FitReport {
  const peers = snapshot.protocols.filter(isPeer).sort((a, b) => cmp(a.slug, b.slug));
  const fitHalf = peers.filter((_, i) => i % 2 === 0);
  const testHalf = peers.filter((_, i) => i % 2 === 1);
  const half = baseComparables(fitHalf, snapshot.protocols);
  half.fit = fitPeers(fitHalf, snapshot.as_of, half, model);
  const errMedian: number[] = [];
  const errFit: number[] = [];
  for (const p of testHalf) {
    const base = p.tvl_usd * categoryMultiple(p.category, half, model).pm;
    const a = adjustments(p, snapshot.as_of, half, model);
    errMedian.push(Math.abs(Math.log(p.mcap_usd! / base)));
    errFit.push(Math.abs(Math.log(p.mcap_usd! / (base * a.base * a.size * a.growth * a.maturity * a.chain))));
  }
  const all = comparables(snapshot, model);
  return {
    features: ['intercept', 'ln TVL', '7d change (clamped ±50)', 'ln age (years)', 'ln chains'],
    coefficients: all.fit.coef.map(round4),
    means: all.fit.means.map(round4),
    fallback: all.fit.fallback,
    peers_fit_all: all.peerTotal,
    peers_fit_half: fitHalf.length,
    peers_test_half: testHalf.length,
    error_median_only: round4(median(errMedian)),
    error_fitted: round4(median(errFit)),
    half_coefficients: half.fit.coef.map(round4),
  };
}

/** One protocol's implied value and the factors behind it. */
export function impliedValue(p: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants = MODEL): { implied: number; breakdown: ModelBreakdown } {
  const { pm, n } = categoryMultiple(p.category, comps, model);
  const a = adjustments(p, asOf, comps, model);
  const implied = Math.max(1, Math.round(p.tvl_usd * pm * a.base * a.size * a.growth * a.maturity * a.chain));
  return {
    implied,
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

/** Per-category launch odds: tokenized / (tokenized + pre-token) among protocols with TVL >= $1M, smoothed toward the global rate. */
export function launchOdds(snapshot: Snapshot): { globalRate: number; byCategory: Map<string, OddsRow> } {
  const counts = new Map<string, { tokenized: number; pre_token: number }>();
  let tok = 0;
  let pre = 0;
  for (const p of snapshot.protocols) {
    if (p.tvl_usd < FIT.odds_min_tvl_usd) continue;
    const c = counts.get(catKey(p.category)) ?? { tokenized: 0, pre_token: 0 };
    if (isPreToken(p)) { c.pre_token++; pre++; } else { c.tokenized++; tok++; }
    counts.set(catKey(p.category), c);
  }
  const globalRate = tok + pre === 0 ? 0.5 : tok / (tok + pre);
  const byCategory = new Map<string, OddsRow>();
  for (const [category, c] of counts) {
    const odds = (c.tokenized + FIT.odds_smoothing * globalRate) / (c.tokenized + c.pre_token + FIT.odds_smoothing);
    byCategory.set(category, { category, tokenized: c.tokenized, pre_token: c.pre_token, odds: round4(clampTo(odds, FIT.odds_min, FIT.odds_max)) });
  }
  return { globalRate, byCategory };
}

/** Airdrop share one wallet is assumed to capture: the pool's share of token value spread over equal-weight wallets. */
export const AIRDROP_SHARE = FIT.airdrop_pool_share / FIT.airdrop_wallets;

const usd = (n: number): string => (n >= 10 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`);

/** Farm totals and the costed verdict for one row. */
export function farmVerdict(steps: FarmStep[], riskAdjusted: number): { cost: number; hours: number; verdict: string } {
  const cost = Math.round(steps.reduce((s, x) => s + x.cost_usd, 0) * 100) / 100;
  const hours = Math.round(steps.reduce((s, x) => s + x.hours, 0) * 100) / 100;
  const allIn = cost + hours * FIT.hour_value_usd;
  const ev = riskAdjusted * AIRDROP_SHARE;
  const ratio = ev / allIn;
  const label = ratio >= FIT.worth_ratio ? 'Worth it' : ratio >= FIT.marginal_ratio ? 'Marginal' : 'Skip';
  const verdict = `${label}: expected ${usd(ev)} (risk-adjusted ${usd(riskAdjusted)} x ${(AIRDROP_SHARE * 100).toFixed(4)}% airdrop share) vs all-in ${usd(allIn)} (${usd(cost)} fees + ${hours.toFixed(1)}h x $${FIT.hour_value_usd}), ${ratio.toFixed(2)}x.`;
  return { cost, hours, verdict };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = comparables(snapshot, model);
  const odds = launchOdds(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
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
  return scored.map((s, i) => {
    const o = odds.byCategory.get(catKey(s.p.category));
    const launch = o?.odds ?? round4(clampTo(odds.globalRate, FIT.odds_min, FIT.odds_max));
    const risk = Math.round(s.implied * launch);
    const steps = farmSteps(s.p, s.breakdown.age_days);
    const fv = farmVerdict(steps, risk);
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
      launch_basis: { tokenized: o?.tokenized ?? 0, pre_token: o?.pre_token ?? 0 },
      model: s.breakdown,
      farm_steps: steps.map(stepText),
      farm_cost_usd: fv.cost,
      farm_hours: fv.hours,
      farm_verdict: fv.verdict,
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, by TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Hold time by age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

const CHEAP_L2 = new Set(['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'zkSync', 'Linea', 'Scroll', 'Mantle', 'Mode', 'Blast']);

/** Gas estimate by the primary chain's class. */
export function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $12-25 of gas';
  if (CHEAP_L2.has(chain)) return 'about $0.50-3 of gas';
  if (chain === 'Solana') return 'about $0.20-1 of fees';
  return 'about $2-6 of gas';
}

/** Midpoint of gasFor's range, in dollars. */
function gasMid(chain: string): number {
  if (chain === 'Ethereum') return 18.5;
  if (CHEAP_L2.has(chain)) return 1.75;
  if (chain === 'Solana') return 0.6;
  return 4;
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

/** A protocol's 7-step farm plan, derived from its own record (category, chains, TVL, age). */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const g = gasMid(chain);
  const weeks = Math.ceil(hold / 7);
  return [
    { text: `Create a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, offline.`, cost: 'under $3 of gas', time: '5 minutes', cost_usd: 1.5, hours: 5 / 60 },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and ${gas}`, time: '15 minutes', cost_usd: g, hours: 15 / 60 },
    { text: secondFor(p, capital, chain), cost: `${gas}`, time: '10 minutes', cost_usd: g, hours: 10 / 60 },
    { text: `Make one qualifying action each week, such as a deposit, a swap or a vote, so the wallet shows steady use.`, cost: `${gas} a week`, time: '10 min/week', cost_usd: g * weeks, hours: (10 * weeks) / 60 },
    { text: `Hold the position for at least ${hold} days, so the activity is counted across more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days`, cost_usd: 0, hours: 0 },
    { text: `Check the protocol's own points or rewards page, and claim only from the link that page publishes. Never pay to claim.`, cost: 'no fee to check', time: '10 minutes', cost_usd: 0, hours: 10 / 60 },
    { text: `${riskFor(p)} Record the wallet, dates and every transaction in a farm log, then withdraw and unwind the position.`, cost: `${gas} to exit`, time: '20 minutes', cost_usd: g, hours: 20 / 60 },
  ];
}

/** The live-token protocols, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || cmp(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** A board row's form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
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
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = comparables(snapshot, model);
  const odds = launchOdds(snapshot);
  const peers: PeerRow[] = [...comps.byCategory]
    .map(([category, v]) => ({ category, n: v.n, median_multiple: round4(v.median), multiple: round4(categoryMultiple(category, comps, model).pm) }))
    .sort((a, b) => b.n - a.n || cmp(a.category, b.category));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
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
    rows: board.map(radarRow),
    live,
    peers,
    fit: validate(snapshot, model),
    coverage: coverage(snapshot, board),
    odds: {
      global_rate: round4(odds.globalRate),
      smoothing: FIT.odds_smoothing,
      min_tvl_usd: FIT.odds_min_tvl_usd,
      categories: [...odds.byCategory.values()].sort((a, b) => b.tokenized + b.pre_token - (a.tokenized + a.pre_token) || cmp(a.category, b.category)),
    },
    farm: { airdrop_pool_share: FIT.airdrop_pool_share, airdrop_wallets: FIT.airdrop_wallets, airdrop_share: AIRDROP_SHARE, hour_value_usd: FIT.hour_value_usd, worth_ratio: FIT.worth_ratio, marginal_ratio: FIT.marginal_ratio },
  };
  return { board, radar };
}

/** The calibration in one line: model version, peers, held-out errors of the fit against the category median alone. */
export function calibrationSummary(radar: RadarData): string {
  const f = radar.fit;
  const fitText = f.fallback ? 'fit degenerate, radar-2 constants used' : `fit coefficients [${f.coefficients.join(', ')}] (${f.features.join(', ')})`;
  return `model ${radar.model_version}, ${radar.peer_total} peers, global median x${radar.global_median_multiple}, cap x${radar.peer_cap_multiple}; held-out median abs log error ${f.error_fitted} fitted vs ${f.error_median_only} category-median-only (${f.peers_fit_half} fit / ${f.peers_test_half} test); ${fitText}`;
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
