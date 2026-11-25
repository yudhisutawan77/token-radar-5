// Token Radar, model version radar-5.
//
// One sealed snapshot goes in; one ranked board comes out. The ranking is
// priced off the snapshot's own live market, never off a hand-picked
// multiple, in four steps:
//
//   size  — a log-log curve fitted on the live-token protocols, ln(mcap) =
//           a + b * ln(TVL), with one shrunk offset per category;
//   growth — the 7-day TVL change, clamped, moves the value a little;
//   age   — older protocols earn a maturity factor that rises to 1.00 at
//           three years; an unknown listing date is treated as one year;
//   haircut — 0.85, because a token that does not exist yet cannot be sold.
//
//   implied = round(TVL * fittedMultiple * growth * maturity * 0.85)
//
// Two fit choices are what make this version different from radar-4, and
// both were picked by the blind tests in lib/validation.ts, not by taste:
// exchange tokens stay out of the fit (their multiples price the exchange's
// revenue, not the protocol's TVL), and the category offsets are shrunk
// with 16 pseudo-observations instead of 8, so a category with a single
// live protocol cannot inherit that protocol's offset wholesale. Ratios
// outside [0.02, 20] never reach the fit, so one outlier cannot set the
// price, and no protocol name is ever special-cased — the same function
// scores every row, and the dashboard prints every input, so any row can
// be recomputed by hand.
//
// Coverage: the watchlist is the floor and is always ranked. The early
// radar adds every other pre-token protocol that clears the same launch
// screen, above the floor as well as below it, because the board ranks
// what the live market would pay, not the watchlist's cutoff. Live-token
// protocols are kept apart in a Live view with their market caps, never
// mixed into the ranking.
//
// Farm verdicts: every row carries its farm plan costed to the dollar —
// gas, time at $25 an hour, carry on locked capital at 5% a year — netted
// against the expected payout at the band's low end (the multiple at its
// 0.08x floor) times a stated farmer share of 0.0025% (5% of supply to
// about 2,000 qualifying wallets). The share is an assumption, stated in
// the open, not a fact: the verdict is a cost screen, not a promise of a
// payout. FARM clears a $50 low-end net, THIN covers its cost, SKIP does
// not.

/** One protocol record from the sealed snapshot: exactly its ten fields. */
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

/** The model's tunable constants, exactly as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  pre_token_discount: number;
  shrink_pseudo: number;
  multiple_floor: number;
  multiple_cap: number;
  ratio_low: number;
  ratio_high: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  pre_token_discount: 0.85,
  shrink_pseudo: 16,
  multiple_floor: 0.08,
  multiple_cap: 1.2,
  ratio_low: 0.02,
  ratio_high: 20,
};

/** Categories kept out of the curve's fit (never out of the board): their tokens price something else. */
export const FIT_EXCLUDED_CATEGORIES = new Set(['CEX']);

/** The model's version label, shown by the dashboard. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One qualifying wallet's share of a launch: 5% of supply to about 2,000 wallets. A stated assumption, not a fact. */
export const FARMER_SHARE = 0.000025;
/** The low-end net a farm must clear to earn FARM instead of THIN. */
export const FARM_THRESHOLD_USD = 50;
/** What an hour of the farmer's time is worth inside the cost total. */
export const TIME_VALUE_PER_HOUR_USD = 25;
/** The yearly carry on locked capital: the T-bill rate the capital could earn elsewhere. */
export const CARRY_APR = 0.05;

/** One step of a farm plan: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  implied_value_usd: number;
  model: {
    category_multiple: number;
    comparables_n: number;
    category_median: number | null;
    global_median: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  /** The farm plan's economics, netted to the dollar, with its verdict. */
  farm: FarmEconomics;
}

/** A board row in the dashboard's compact form; the farm plan rides along so the page never re-derives it. */
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
  implied_value_usd: number;
  category_multiple: number;
  comparables_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
  /** FARM, THIN or SKIP: whether the farm plan nets out at the band's low end. */
  farm_verdict: 'FARM' | 'THIN' | 'SKIP';
  /** The low-end net in dollars: the expected payout minus the plan's total cost. */
  farm_net_low_usd: number;
  /** What the seven farm steps cost, gas plus time plus carry, in dollars. */
  farm_cost_usd: number;
  /** The implied value at the band's low end, in dollars. */
  farm_low_end_usd: number;
  /** The expected payout at the band's low end, in dollars. */
  farm_expected_usd: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl: number | null;
  change_7d: number | null;
}

/** One category's place in the size curve: its offset, and the fitted multiple at its own median TVL. */
export interface Comparable {
  category: string;
  n: number;
  /** The median market-cap / TVL of the category's live protocols, for reference. */
  median: number | null;
  /** The fitted multiple at the category's median live TVL: what the curve charges a typical protocol of this kind. */
  multiple: number;
  /** The category's shrunk log-point offset in the curve (0 when the category has no live protocol). */
  offset: number;
  /** The median live TVL of the category, or null when it has no live protocol. */
  median_tvl: number | null;
}

/** The fitted size curve: ln(market cap) = intercept + slope x ln(TVL) + the category's offset. */
export interface CurveFit {
  intercept: number;
  slope: number;
  byCategory: Map<string, Comparable>;
  /** The median market-cap / TVL over all live comparables: the fallback when a TVL cannot be logged. */
  globalMedian: number;
}

/** The farm plan's economics, netted to the dollar, for one protocol. */
export interface FarmEconomics {
  /** Gas for the seven steps, in dollars, from the plan's own cost strings. */
  gas_usd: number;
  /** The farmer's time, at $25 an hour, for the plan's minutes. */
  time_usd: number;
  /** The carry on the locked capital at 5% a year over the hold. */
  carry_usd: number;
  /** Gas plus time plus carry: what the farm costs. */
  total_cost_usd: number;
  /** The implied value at the band's low end: the multiple at its 0.08x floor. */
  low_end_implied_usd: number;
  /** The expected payout: the low-end value times the farmer's share. */
  expected_payout_usd: number;
  /** The payout at the fitted implied value, minus the cost. */
  net_usd: number;
  /** The payout at the band's low end, minus the cost: the conservative net. */
  net_low_usd: number;
  /** FARM when the low-end net clears $50, THIN when it covers its cost, SKIP when it does not. */
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** Everything the dashboard needs: the board, the live set, the comparables and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  screened_out: number;
  screen_reasons: { reason: string; count: number }[];
  comparables: Comparable[];
  global_median: number;
  /** The fitted size curve's intercept and slope, so the dashboard can state the fit. */
  curve: { intercept: number; slope: number };
  rows: RadarRow[];
  live: LiveRow[];
  /** The farm plan's stated assumptions: the share, the hour's value, the carry rate, the FARM threshold. */
  farm_assumptions: {
    farmer_share: number;
    time_value_per_hour_usd: number;
    carry_apr: number;
    farm_threshold_usd: number;
  };
  /** The out-of-sample validation, attached by main.ts; absent in dev-only runs. */
  validation?: import('./validation.ts').ValidationReport;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Clamp `v` into [`lo`, `hi`]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A finite number, else `fallback`. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to four decimals, the precision the dashboard prints. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Round to two decimals, the precision the farm economics print. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The median of a list of numbers, or null when it holds nothing. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

// ---------------------------------------------------------------------------
// Reading the snapshot
// ---------------------------------------------------------------------------

/** Is `v` a plain JSON object (not null, not an array)? */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A string field, or null when it is absent or not a string. */
function optString(p: Record<string, unknown>, key: string): string | null {
  return typeof p[key] === 'string' ? (p[key] as string) : null;
}

/** A finite-number field, or null when it is absent or not a finite number. */
function optNumber(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (!isRecord(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof raw.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof raw.floor_usd !== 'number' || !Number.isSafeInteger(raw.floor_usd) || raw.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(raw.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = raw.protocols.map((v, i) => {
    if (!isRecord(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    if (typeof v.slug !== 'string' || typeof v.name !== 'string' || typeof v.tvl_usd !== 'number' || !Number.isFinite(v.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: v.slug,
      name: v.name,
      category: optString(v, 'category'),
      chains: Array.isArray(v.chains) ? v.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: v.tvl_usd,
      change_7d: optNumber(v, 'change_7d'),
      mcap_usd: optNumber(v, 'mcap_usd'),
      listed_at: optString(v, 'listed_at'),
      gecko_id: optString(v, 'gecko_id'),
      symbol: optString(v, 'symbol'),
    };
  });
  return {
    as_of: raw.as_of,
    source: raw.source,
    floor_usd: raw.floor_usd,
    protocols,
    watchlist: raw.watchlist as string[],
  };
}

// ---------------------------------------------------------------------------
// The size curve
// ---------------------------------------------------------------------------

/** One live-token protocol as the fit sees it: its category, TVL and market cap, all in logs. */
interface FitPoint {
  category: string;
  tvl: number;
  mcap: number;
  logTvl: number;
  logMcap: number;
}

/**
 * The protocols the curve is fitted on, in snapshot order: live-token
 * protocols with a usable TVL and market cap, exchange tokens left out,
 * ratios outside [ratio_low, ratio_high] dropped. A protocol that fails
 * any of those never reaches the fit.
 */
function fitPoints(snapshot: Snapshot, model: ModelConstants): FitPoint[] {
  const points: FitPoint[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (FIT_EXCLUDED_CATEGORIES.has(p.category ?? '')) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < model.ratio_low || ratio > model.ratio_high) continue;
    points.push({ category: p.category ?? 'Other', tvl: p.tvl_usd, mcap: p.mcap_usd, logTvl: Math.log(p.tvl_usd), logMcap: Math.log(p.mcap_usd) });
  }
  return points;
}

/** Per-category accumulators for the offset step: ratios, TVLs and residuals of its live protocols. */
interface CategoryAcc {
  ratios: number[];
  tvls: number[];
  residuals: number[];
}

/**
 * The size curve, fitted on the live-token protocols: ordinary least
 * squares of ln(market cap) on ln(TVL), then one offset per category —
 * the mean residual of its live protocols, shrunk toward zero with the
 * model's pseudo-observations. Exchange tokens are left out of the fit
 * before it starts: their multiples price the exchange behind them, not
 * the protocol in front of them, and the blind tests say the curve prices
 * launches better without them. Ratios outside [ratio_low, ratio_high]
 * are dropped before the fit, so one outlier cannot bend the curve. A
 * category with no live protocol gets offset zero and the curve's own
 * prediction.
 */
export function fitCurve(snapshot: Snapshot, model: ModelConstants = MODEL): CurveFit {
  const points = fitPoints(snapshot, model);
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  for (const pt of points) {
    sumX += pt.logTvl;
    sumY += pt.logMcap;
  }
  const meanX = sumX / Math.max(1, n);
  const meanY = sumY / Math.max(1, n);
  let sxx = 0;
  let sxy = 0;
  for (const pt of points) {
    const dx = pt.logTvl - meanX;
    sxx += dx ** 2;
    sxy += dx * (pt.logMcap - meanY);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const globalMedian = medianOf(points.map((pt) => pt.mcap / pt.tvl)) ?? 0.2;

  const byCat = new Map<string, CategoryAcc>();
  for (const pt of points) {
    let acc = byCat.get(pt.category);
    if (acc === undefined) {
      acc = { ratios: [], tvls: [], residuals: [] };
      byCat.set(pt.category, acc);
    }
    acc.ratios.push(pt.mcap / pt.tvl);
    acc.tvls.push(pt.tvl);
    acc.residuals.push(pt.logMcap - (intercept + slope * pt.logTvl));
  }

  const fitted = new Map<string, Comparable>();
  for (const [category, acc] of byCat) {
    const offset = acc.residuals.reduce((s, v) => s + v, 0) / (acc.residuals.length + model.shrink_pseudo);
    const medianTvl = medianOf(acc.tvls);
    const median = medianOf(acc.ratios);
    const multiple =
      medianTvl === null
        ? clamp(globalMedian, model.multiple_floor, model.multiple_cap)
        : clamp(Math.exp(intercept + slope * Math.log(medianTvl) + offset) / medianTvl, model.multiple_floor, model.multiple_cap);
    fitted.set(category, { category, n: acc.ratios.length, median, multiple, offset, median_tvl: medianTvl });
  }
  return { intercept, slope, byCategory: fitted, globalMedian };
}

/**
 * The fitted multiple for one protocol: the curve's prediction at its own
 * TVL with its category's offset, clamped to [multiple_floor,
 * multiple_cap]. A TVL that cannot be logged falls back to the global
 * median, clamped the same way — the clamp is what keeps the band's low
 * end below the implied value in every row.
 */
function fittedMultiple(p: SnapshotProtocol, fit: CurveFit, model: ModelConstants): { multiple: number; n: number; median: number | null } {
  const fallback = clamp(fit.globalMedian, model.multiple_floor, model.multiple_cap);
  if (!(p.tvl_usd > 0)) return { multiple: fallback, n: 0, median: null };
  const entry = fit.byCategory.get(p.category ?? 'Other');
  const offset = entry?.offset ?? 0;
  const multiple = clamp(Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd) + offset) / p.tvl_usd, model.multiple_floor, model.multiple_cap);
  return { multiple, n: entry?.n ?? 0, median: entry?.median ?? null };
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CurveFit,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; compN: number; compMedian: number | null; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finiteOr(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { multiple, n, median } = fittedMultiple(protocol, fit, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * model.pre_token_discount));
  return { implied, multiple, compN: n, compMedian: median, growthPct, growthMult, maturityMult, age };
}

// ---------------------------------------------------------------------------
// The launch screen
// ---------------------------------------------------------------------------

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product, not a launch of their own. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol must not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** One screen rule, in the order it is checked: the first rule that fires names the reason. */
interface ScreenRule {
  test: (p: SnapshotProtocol) => boolean;
  reason: (p: SnapshotProtocol) => string;
}

const SCREEN_RULES: ScreenRule[] = [
  { test: (p) => EXCLUDED_CATEGORIES.has(p.category ?? ''), reason: (p) => `category ${p.category}` },
  { test: (p) => VERSIONED.test(p.name), reason: () => 'versioned name' },
  { test: (p) => /\b(wrapped|staked|staking)\b/i.test(p.name), reason: () => 'wrapped or staked name' },
  { test: (p) => EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e)), reason: () => 'exchange product' },
];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The reason a pre-token protocol fails the launch screen, or null when it passes. */
export function screenReason(p: SnapshotProtocol): string | null {
  for (const rule of SCREEN_RULES) {
    if (rule.test(p)) return rule.reason(p);
  }
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and past the launch screen. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && screenReason(p) === null;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  fitOverride?: CurveFit,
): { board: BoardRow[]; screenedOut: number; screenReasons: { reason: string; count: number }[] } {
  const fit = fitOverride ?? fitCurve(snapshot, model);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  // The watchlist is the floor: every slug on it is ranked, whatever the
  // screen would say. The early radar then adds every other pre-token
  // protocol that passes the same launch screen the watchlist uses, above
  // the floor as well as below it — the board ranks what the live market
  // would pay, not the watchlist's cutoff.
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const reasonCounts = new Map<string, number>();
  let screenedOut = 0;
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !isPreToken(p)) continue;
    const reason = screenReason(p);
    if (reason !== null) {
      screenedOut++;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      continue;
    }
    chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
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
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      comparables_n: s.compN,
      category_median: s.compMedian,
      global_median: fit.globalMedian,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    farm: farmEconomics(s.p, s.age, s.implied, s.multiple, s.growthMult, s.maturityMult, model),
  }));
  const screenReasons = [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  return { board, screenedOut, screenReasons };
}

// ---------------------------------------------------------------------------
// The farm plan
// ---------------------------------------------------------------------------

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * One category family's two qualifying actions, in the words a farmer can
 * follow: the main position, then a second touchpoint on the same
 * protocol. The table is tried top to bottom; the first family whose
 * keywords match the category wins, and the last row is the fallback for
 * a category no family claims.
 */
interface ActionFamily {
  matches: (categoryLower: string) => boolean;
  first: (name: string, capital: number, chain: string) => string;
  second: (name: string, chain: string) => string;
}

const ACTION_FAMILIES: ActionFamily[] = [
  {
    matches: (c) => c.includes('lend') || c.includes('collateral'),
    first: (name, capital, chain) => `Lend $${capital} of USDC through ${name} on ${chain} and leave the supply in place.`,
    second: (name) => `Borrow $20 against that supply on ${name}, then repay it within the week.`,
  },
  {
    matches: (c) => c.includes('cdp'),
    first: (name, capital, chain) => `Lock $${capital} of collateral in ${name} on ${chain} and borrow its stable asset against it.`,
    second: (name) => `Repay a small part of what you borrowed on ${name}, then borrow it again.`,
  },
  {
    matches: (c) => c.includes('dex') || c.includes('leveraged farm'),
    first: (name, capital, chain) => `Add $${capital} of liquidity to the main ${name} pool on ${chain} and leave the position open.`,
    second: (name, chain) => `Swap $25 through the main ${name} pool on ${chain}.`,
  },
  {
    matches: (c) => c.includes('yield') || c.includes('curator') || c.includes('allocator'),
    first: (name, capital, chain) => `Put $${capital} into a ${name} vault on ${chain} and hold the shares.`,
    second: (name, chain) => `Put $25 into a second ${name} vault on ${chain}.`,
  },
  {
    matches: (c) => c.includes('restak') || c.includes('staking'),
    first: (name, capital) => `Stake $${capital} through ${name} and keep the staking receipt.`,
    second: (name, chain) => `Stake a second $25 through ${name} on ${chain}.`,
  },
  {
    matches: (c) => c.includes('rwa'),
    first: (name, capital, chain) => `Buy $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it through one payout.`,
    second: (name) => `Hold the ${name} asset through one payout and collect it.`,
  },
  {
    matches: (c) => c.includes('basis'),
    first: (name, capital, chain) => `Place $${capital} in the ${name} basis vault on ${chain} and leave it there.`,
    second: (name, chain) => `Look at ${name}'s funding rate on ${chain} and rebalance the vault once.`,
  },
  {
    matches: (c) => c.includes('perpetual') || c.includes('derivative'),
    first: (name, capital) => `Post $${capital} of USDC as margin on ${name} and open one small hedged trade.`,
    second: (name) => `Close the hedged trade on ${name} and open a new one at half the size.`,
  },
  {
    matches: (c) => c.includes('prediction'),
    first: (name, capital) => `Fund an account with $${capital} and take one position in a ${name} market.`,
    second: (name) => `Settle one ${name} market and open a second $10 position.`,
  },
  {
    matches: (c) => c.includes('insurance'),
    first: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`,
    second: (name) => `Check the claim flow on ${name} and renew the cover once.`,
  },
  {
    matches: (c) => c.includes('stable'),
    first: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset issued through ${name} on ${chain}.`,
    second: (name) => `Redeem $25 of the stable asset through ${name}, then mint it again.`,
  },
  {
    matches: (c) => c.includes('chain') || c.includes('payment'),
    first: (name, capital, chain) => `Create a ${name} wallet on ${chain}, fund it with $${capital}, and pay for one real thing with it.`,
    second: (name, chain) => `Send a second payment through ${name} on ${chain} to a wallet you control.`,
  },
  {
    matches: (c) => c.includes('governance'),
    first: (name, capital, chain) => `Lock $${capital} in the ${name} governance vault on ${chain} and cast one vote.`,
    second: (name, chain) => `Vote on a second ${name} proposal on ${chain}.`,
  },
  {
    matches: () => true,
    first: (name, capital, chain) => `Deposit $${capital} of USDC with ${name} on ${chain} and leave the position open.`,
    second: (name, chain) => `Add a second $25 deposit to ${name} on ${chain} a week later.`,
  },
];

/** The action family a protocol's category belongs to: the first match wins. */
function actionFamilyFor(p: SnapshotProtocol): ActionFamily {
  const c = (p.category ?? '').toLowerCase();
  return ACTION_FAMILIES.find((f) => f.matches(c))!;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names. No token is
 * promised: the plan farms usage history, and the detail view says so in
 * plain words.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = actionFamilyFor(p);
  const openGas = capital >= 150 ? 8 : 4;
  return [
    { text: 'Start with a fresh wallet that holds only the funds you mean to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: family.first(p.name, capital, chain), cost: `$${capital} of capital and about $${openGas} of gas`, time: '15 minutes to set up' },
    { text: family.second(p.name, chain), cost: 'about $25 of capital and $2 of gas', time: '10 minutes' },
    { text: 'Do one qualifying action every week — a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Keep the position open for at least ${hold} days so the activity shows up in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Keep a farm log — the wallet, the dates and every transaction — so you can repeat the position or unwind it in stages.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/**
 * A protocol's farm economics: the seven steps' costs totalled, against
 * the value at stake. The gas and the minutes come from the same inputs
 * the plan's prose is written from (capitalFor, holdDaysFor), so the
 * numbers and the words cannot disagree: $3 of gas to start, $4 or $8 to
 * open the position, $2 for the second action, $2 of gas a week while it
 * runs, and 45 minutes plus 10 a week of the farmer's time.
 */
export function farmEconomics(
  p: SnapshotProtocol,
  age: number | null,
  implied: number,
  multiple: number,
  growthMult: number,
  maturityMult: number,
  model: ModelConstants = MODEL,
): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gas = 3 + (capital >= 150 ? 8 : 4) + 2 + 2 * weeks;
  const minutes = 5 + 15 + 10 + 10 * weeks + 10 + 5;
  const time = (minutes / 60) * TIME_VALUE_PER_HOUR_USD;
  const carry = capital * CARRY_APR * (hold / 365);
  const total = gas + time + carry;
  const lowEnd = Math.max(1, Math.round(p.tvl_usd * model.multiple_floor * growthMult * maturityMult * model.pre_token_discount));
  const expected = lowEnd * FARMER_SHARE;
  const netLow = expected - total;
  const net = implied * FARMER_SHARE - total;
  return {
    gas_usd: round2(gas),
    time_usd: round2(time),
    carry_usd: round2(carry),
    total_cost_usd: round2(total),
    low_end_implied_usd: lowEnd,
    expected_payout_usd: round2(expected),
    net_usd: round2(net),
    net_low_usd: round2(netLow),
    verdict: netLow >= FARM_THRESHOLD_USD ? 'FARM' : netLow >= 0 ? 'THIN' : 'SKIP',
  };
}

// ---------------------------------------------------------------------------
// The dashboard's views
// ---------------------------------------------------------------------------

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  live.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return live.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js, farm plan included so the page never re-derives it. */
export function radarRow(row: BoardRow, watchlist: boolean): RadarRow {
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
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    comparables_n: row.model.comparables_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist,
    farm_steps: row.farm_steps,
    farm_verdict: row.farm.verdict,
    farm_net_low_usd: row.farm.net_low_usd,
    farm_cost_usd: row.farm.total_cost_usd,
    farm_low_end_usd: row.farm.low_end_implied_usd,
    farm_expected_usd: row.farm.expected_payout_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, screenedOut, screenReasons } = buildBoard(snapshot, model);
  const fit = fitCurve(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const comparables: Comparable[] = [...fit.byCategory.values()].sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: 'DefiLlama protocol index, fetched 2026-11-14',
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    screened_out: screenedOut,
    screen_reasons: screenReasons,
    comparables,
    global_median: round4(fit.globalMedian),
    curve: { intercept: round4(fit.intercept), slope: round4(fit.slope) },
    rows: board.map((r) => radarRow(r, watchlist.has(r.slug))),
    live,
    farm_assumptions: {
      farmer_share: FARMER_SHARE,
      time_value_per_hour_usd: TIME_VALUE_PER_HOUR_USD,
      carry_apr: CARRY_APR,
      farm_threshold_usd: FARM_THRESHOLD_USD,
    },
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------
// The gate's own checks, and the dashboard's data script
// ---------------------------------------------------------------------------

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
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    const f = r.farm;
    if (!f || (f.verdict !== 'FARM' && f.verdict !== 'THIN' && f.verdict !== 'SKIP')) return `${r.slug} has no farm verdict`;
    for (const n of [f.gas_usd, f.time_usd, f.carry_usd, f.total_cost_usd, f.low_end_implied_usd, f.expected_payout_usd, f.net_usd, f.net_low_usd]) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return `${r.slug} has a non-finite farm number`;
    }
    if (f.low_end_implied_usd > r.implied_value_usd) return `${r.slug} has a low end above its implied value`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
