// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
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
//   implied        = max(1, round(tvl x peerMultiple x sizeAdj x growthAdj x maturityAdj x chainAdj))
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

export const MODEL_VERSION = 'radar-2';

/** Early rows carried below the watchlist floor, by implied value. */
export const EARLY_ROWS = 200;

/** Live-token protocols shown apart, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The model's workings for one row. */
export interface ModelBreakdown {
  peer_multiple: number;
  peer_count: number;
  size_adj: number;
  growth_adj: number;
  maturity_adj: number;
  chain_adj: number;
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
  model: ModelBreakdown;
  farm_steps: string[];
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
  model: ModelBreakdown;
  farm_steps: string[];
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

/** Whether a protocol is one the early board may rank. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !(p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const catKey = (c: string | null): string => c ?? 'Uncategorized';
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Median of numbers (0 when empty). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The comparables the model calibrates on: token-bearing protocols with TVL, as mcap/TVL. */
export interface Comparables {
  globalMedian: number;
  peerTotal: number;
  /** The 90th percentile (nearest-rank) of all peer ratios: no category multiple exceeds it. */
  cap: number;
  byCategory: Map<string, { n: number; median: number }>;
  growthByCategory: Map<string, number>;
}

export function comparables(snapshot: Snapshot): Comparables {
  const all: number[] = [];
  const cats = new Map<string, number[]>();
  const growth = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const r = p.mcap_usd / p.tvl_usd;
      all.push(r);
      const k = catKey(p.category);
      (cats.get(k) ?? cats.set(k, []).get(k)!).push(r);
    }
    if (isPreToken(p) && p.change_7d !== null) {
      const k = catKey(p.category);
      (growth.get(k) ?? growth.set(k, []).get(k)!).push(p.change_7d);
    }
  }
  const byCategory = new Map<string, { n: number; median: number }>();
  for (const [k, v] of cats) byCategory.set(k, { n: v.length, median: median(v) });
  const growthByCategory = new Map<string, number>();
  for (const [k, v] of growth) growthByCategory.set(k, median(v));
  const sorted = [...all].sort((a, b) => a - b);
  const cap = sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(0.9 * sorted.length) - 1)]!;
  return { globalMedian: median(all), peerTotal: all.length, cap, byCategory, growthByCategory };
}

/** The shrunk category multiple: few category peers lean on the global median. */
export function peerMultiple(n: number, catMedian: number, globalMedian: number, model: ModelConstants = MODEL): number {
  return n >= 1 ? (n * catMedian + model.prior_weight * globalMedian) / (n + model.prior_weight) : globalMedian;
}

/** One protocol's implied value and the factors behind it. */
export function impliedValue(p: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants = MODEL): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, p.listed_at);
  const cat = comps.byCategory.get(catKey(p.category));
  const n = cat?.n ?? 0;
  const pm = Math.min(peerMultiple(n, cat?.median ?? 0, comps.globalMedian, model), comps.cap);
  const sizeAdj = p.tvl_usd > model.size_knee_usd ? 1 / (1 + model.size_slope * Math.log10(p.tvl_usd / model.size_knee_usd)) : 1;
  const g = p.change_7d ?? comps.growthByCategory.get(catKey(p.category)) ?? 0;
  const growthAdj = 1 + (g >= 0 ? model.growth_up : model.growth_down) * Math.tanh(g / model.growth_scale);
  const ageUsed = Math.min(age ?? model.unknown_age_days, model.maturity_cap_days);
  const maturityAdj = model.maturity_floor + model.maturity_range * (Math.log1p(ageUsed / model.maturity_scale_days) / Math.log1p(model.maturity_cap_days / model.maturity_scale_days));
  const chainAdj = 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_cap);
  const implied = Math.max(1, Math.round(p.tvl_usd * pm * sizeAdj * growthAdj * maturityAdj * chainAdj));
  return {
    implied,
    breakdown: {
      peer_multiple: round4(pm),
      peer_count: n,
      size_adj: round4(sizeAdj),
      growth_adj: round4(growthAdj),
      maturity_adj: round4(maturityAdj),
      chain_adj: round4(chainAdj),
      age_days: age,
    },
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = comparables(snapshot);
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
  return scored.map((s, i) => ({
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
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days).map(stepText),
  }));
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

type CategoryKind = 'lending' | 'cdp' | 'dex' | 'derivatives' | 'bridge' | 'curator' | 'yield' | 'rwa' | 'stablecoin' | 'insurance' | 'staking' | 'basis' | 'launchpad' | 'other';

/** The category's family, from its name; the order settles the overlaps (Yield Aggregator is yield). */
function kindOf(p: SnapshotProtocol): CategoryKind {
  const c = (p.category ?? '').toLowerCase();
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
  return [
    { text: `Create a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, offline.`, cost: 'under $3 of gas', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and ${gas}`, time: '15 minutes' },
    { text: secondFor(p, capital, chain), cost: `${gas}`, time: '10 minutes' },
    { text: `Make one qualifying action each week, such as a deposit, a swap or a vote, so the wallet shows steady use.`, cost: `${gas} a week`, time: '10 min/week' },
    { text: `Hold the position for at least ${hold} days, so the activity is counted across more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Check the protocol's own points or rewards page, and claim only from the link that page publishes. Never pay to claim.`, cost: 'no fee to check', time: '10 minutes' },
    { text: `${riskFor(p)} Record the wallet, dates and every transaction in a farm log, then withdraw and unwind the position.`, cost: `${gas} to exit`, time: '20 minutes' },
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
    model: row.model,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = comparables(snapshot);
  const peers: PeerRow[] = [...comps.byCategory]
    .map(([category, v]) => ({ category, n: v.n, median_multiple: round4(v.median) }))
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
  };
  return { board, radar };
}

/** The calibration in one line: model version, peer count, global median and cap. */
export function calibrationSummary(radar: RadarData): string {
  return `model ${radar.model_version}, ${radar.peer_total} peers, global median x${radar.global_median_multiple}, cap x${radar.peer_cap_multiple}`;
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
    if (![m.peer_multiple, m.size_adj, m.growth_adj, m.maturity_adj, m.chain_adj].every((x) => Number.isFinite(x))) return `${r.slug} has a non-finite model factor`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
