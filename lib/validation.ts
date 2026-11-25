// Token Radar's out-of-sample validation, version radar-5.
//
// The radar-5 model prices a pre-token protocol off a size curve fitted on
// the live market, but it never asked whether that curve predicts anything.
// This module asks, five ways, using only the sealed snapshot:
//
//   1. Leave-one-out (LOOCV). For each of the live-token protocols the
//      curve is fitted on, refit the curve without it and predict its
//      market cap from its TVL alone. The error multiple is max(pred/actual,
//      actual/pred): 2x means the prediction was off by a factor of two.
//   2. Time-split. Fit the curve on the older half of the live
//      protocols (by listing date) and test on the newer half, which the fit
//      never saw. A model that only fits the past fails here.
//   3. Walk-forward. The same idea as the time-split, rolled forward: start
//      with the 30 earliest listings, predict the next 10, grow the training
//      window by 10 and repeat until every dated protocol has been predicted
//      exactly once as a future listing. A model whose edge is a calendar
//      accident fails here.
//   4. Leave-one-category-out. Fit the curve on every category except one
//      and predict that whole category blind, with no offset of its own. A
//      model that only works inside categories it has already seen fails
//      here; this is the fourth held-out way, and the hardest of the four.
//   5. Conformal intervals (jackknife+). From the leave-one-out predictions,
//      take each protocol's absolute log-error and build a 90% prediction
//      interval for it from the OTHER protocols' errors, then count how often
//      the true market cap lands inside. Coverage near 90% means the
//      intervals are honest; the interval's width (as a multiple) says how
//      much the curve actually knows.
//   6. Bootstrap stability. Resample the live comparables with replacement
//      (a fixed seed, so the run is deterministic), refit the curve, rebuild
//      the board, and ask how much the top 10 moves. A board whose top 10
//      is reshuffled by one protocol's multiple is not a ranking a reader
//      can trust.
//
// Everything here is deterministic: no clock, no network, no unseeded
// randomness. The bootstrap uses a mulberry32 generator with a fixed seed,
// so the same snapshot always reports the same numbers. The fit used by
// every test is the model's own fit — the same function, the same
// exclusions, the same shrinkage — so a test result is a statement about
// the model that ships, not about a cousin of it.

import {
  FIT_EXCLUDED_CATEGORIES,
  MODEL,
  buildBoard,
  type CurveFit,
  type ModelConstants,
  type Snapshot,
} from './model.ts';

/** One live-token protocol the model prices from: a market cap over a TVL. */
interface LiveComp {
  slug: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  listed_at: string | null;
}

/** The live protocols the model's comparables are built from, in snapshot order. */
export function liveComparables(snapshot: Snapshot, model: ModelConstants = MODEL): LiveComp[] {
  const out: LiveComp[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (r < model.ratio_low || r > model.ratio_high) continue;
    out.push({ slug: p.slug, category: p.category ?? 'Other', tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, listed_at: p.listed_at });
  }
  return out;
}

/** The median of a sorted array, or null when it holds nothing. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The size curve fitted on an arbitrary list of live protocols: the same
 * log-log OLS fit lib/model.ts uses, so a refit on a subset is the same
 * model with less data, not a different model. Category offsets are the
 * shrunk mean residuals, exactly as in the full fit. Categories the model
 * excludes from the fit (exchange tokens, whose multiples price exchange
 * revenue rather than protocol TVL) are left out of the fit here too.
 */
export function fitCurveFromList(
  list: LiveComp[],
  model: ModelConstants = MODEL,
): CurveFit {
  const usable = list.filter((c) => !FIT_EXCLUDED_CATEGORIES.has(c.category));
  const n = usable.length;
  const xs = usable.map((c) => Math.log(c.tvl_usd));
  const ys = usable.map((c) => Math.log(c.mcap_usd));
  const meanX = xs.reduce((s, v) => s + v, 0) / Math.max(1, n);
  const meanY = ys.reduce((s, v) => s + v, 0) / Math.max(1, n);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - meanX) ** 2;
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const ratios = usable.map((c) => c.mcap_usd / c.tvl_usd).sort((a, b) => a - b);
  const globalMedian = medianOf(ratios) ?? 0.2;
  const sums = new Map<string, { sum: number; n: number }>();
  for (let i = 0; i < n; i++) {
    const r = ys[i]! - (intercept + slope * xs[i]!);
    const e = sums.get(usable[i]!.category) ?? { sum: 0, n: 0 };
    e.sum += r;
    e.n++;
    sums.set(usable[i]!.category, e);
  }
  const byCategory = new Map<string, import('./model.ts').Comparable>();
  for (const [cat, e] of sums) {
    const catList = usable.filter((c) => c.category === cat);
    const catRatios = catList.map((c) => c.mcap_usd / c.tvl_usd).sort((a, b) => a - b);
    const catTvls = catList.map((c) => c.tvl_usd).sort((a, b) => a - b);
    const offset = e.sum / (e.n + model.shrink_pseudo);
    const medianTvl = medianOf(catTvls);
    const median = medianOf(catRatios);
    const multiple =
      medianTvl === null
        ? Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalMedian))
        : Math.min(model.multiple_cap, Math.max(model.multiple_floor, Math.exp(intercept + slope * Math.log(medianTvl) + offset) / medianTvl));
    byCategory.set(cat, { category: cat, n: e.n, median, multiple, offset, median_tvl: medianTvl });
  }
  return { intercept, slope, byCategory, globalMedian };
}

/** The curve's prediction for one protocol: its market cap at its own TVL, with its category's offset. */
function predictMcap(tvl: number, category: string, fit: CurveFit): number {
  return Math.exp(fit.intercept + fit.slope * Math.log(tvl) + (fit.byCategory.get(category)?.offset ?? 0));
}

/** How far a prediction is from the truth, as a multiple: 1x is exact, 2x is off by a factor of two. */
export function errorMultiple(predicted: number, actual: number): number {
  return Math.max(predicted / actual, actual / predicted);
}

/** A sorted list's median, or null when it holds nothing. */
function medianOfErrors(sorted: number[]): number | null {
  return medianOf(sorted);
}

/** The share of errors at or under a multiple. */
function shareWithin(errors: number[], multiple: number): number {
  if (errors.length === 0) return 0;
  let n = 0;
  for (const e of errors) if (e <= multiple) n++;
  return n / errors.length;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Leave-one-out: every live protocol predicted by a fit that never saw it. */
export interface LoocvResult {
  n: number;
  median_error_multiple: number;
  mean_error_multiple: number;
  within_2x: number;
  within_3x: number;
}

export function leaveOneOut(snapshot: Snapshot, model: ModelConstants = MODEL): LoocvResult {
  const live = liveComparables(snapshot, model);
  const errors: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const rest = live.filter((_, j) => j !== i);
    const fit = fitCurveFromList(rest, model);
    const held = live[i]!;
    errors.push(errorMultiple(predictMcap(held.tvl_usd, held.category, fit), held.mcap_usd));
  }
  errors.sort((a, b) => a - b);
  return {
    n: live.length,
    median_error_multiple: round2(medianOfErrors(errors) ?? 0),
    mean_error_multiple: round2(errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length)),
    within_2x: round4(shareWithin(errors, 2)),
    within_3x: round4(shareWithin(errors, 3)),
  };
}

/** Time-split: the older half fits, the newer half is predicted blind. */
export interface TimeSplitResult {
  n_train: number;
  n_test: number;
  cut_date: string;
  median_error_multiple: number;
  within_2x: number;
  within_3x: number;
}

export function timeSplit(snapshot: Snapshot, model: ModelConstants = MODEL): TimeSplitResult {
  const dated = liveComparables(snapshot, model)
    .filter((c) => c.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const fit = fitCurveFromList(train, model);
  const errors: number[] = [];
  for (const held of test) {
    errors.push(errorMultiple(predictMcap(held.tvl_usd, held.category, fit), held.mcap_usd));
  }
  errors.sort((a, b) => a - b);
  return {
    n_train: train.length,
    n_test: test.length,
    cut_date: test.length > 0 ? test[0]!.listed_at! : '',
    median_error_multiple: round2(medianOfErrors(errors) ?? 0),
    within_2x: round4(shareWithin(errors, 2)),
    within_3x: round4(shareWithin(errors, 3)),
  };
}

/** Walk-forward: the time-split rolled forward — each dated protocol predicted once, as a future listing. */
export interface WalkForwardResult {
  n_train_start: number;
  step: number;
  n_test: number;
  median_error_multiple: number;
  mean_error_multiple: number;
  within_2x: number;
  within_3x: number;
}

export function walkForward(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  startN = 30,
  step = 10,
): WalkForwardResult {
  const dated = liveComparables(snapshot, model)
    .filter((c) => c.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const errors: number[] = [];
  let n = startN;
  while (n < dated.length) {
    const fit = fitCurveFromList(dated.slice(0, n), model);
    for (const held of dated.slice(n, Math.min(n + step, dated.length))) {
      errors.push(errorMultiple(predictMcap(held.tvl_usd, held.category, fit), held.mcap_usd));
    }
    n += step;
  }
  errors.sort((a, b) => a - b);
  return {
    n_train_start: startN,
    step,
    n_test: errors.length,
    median_error_multiple: round2(medianOfErrors(errors) ?? 0),
    mean_error_multiple: round2(errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length)),
    within_2x: round4(shareWithin(errors, 2)),
    within_3x: round4(shareWithin(errors, 3)),
  };
}

/** Leave-one-category-out: a whole category predicted blind, with no offset of its own. */
export interface LeaveOneCategoryOutResult {
  n_categories: number;
  n_test: number;
  median_error_multiple: number;
  mean_error_multiple: number;
  within_2x: number;
  within_3x: number;
}

export function leaveOneCategoryOut(snapshot: Snapshot, model: ModelConstants = MODEL): LeaveOneCategoryOutResult {
  const live = liveComparables(snapshot, model);
  const categories = [...new Set(live.map((c) => c.category))];
  const errors: number[] = [];
  for (const cat of categories) {
    const train = live.filter((c) => c.category !== cat);
    const fit = fitCurveFromList(train, model);
    for (const held of live.filter((c) => c.category === cat)) {
      errors.push(errorMultiple(predictMcap(held.tvl_usd, held.category, fit), held.mcap_usd));
    }
  }
  errors.sort((a, b) => a - b);
  return {
    n_categories: categories.length,
    n_test: errors.length,
    median_error_multiple: round2(medianOfErrors(errors) ?? 0),
    mean_error_multiple: round2(errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length)),
    within_2x: round4(shareWithin(errors, 2)),
    within_3x: round4(shareWithin(errors, 3)),
  };
}

/** Conformal intervals (jackknife+): 90% intervals built from leave-one-out errors, coverage counted honestly. */
export interface ConformalResult {
  n: number;
  level: number;
  coverage: number;
  median_interval_factor: number;
}

export function conformalJackknife(snapshot: Snapshot, model: ModelConstants = MODEL, level = 0.9): ConformalResult {
  const live = liveComparables(snapshot, model);
  const logPred: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const rest = live.filter((_, j) => j !== i);
    const fit = fitCurveFromList(rest, model);
    const held = live[i]!;
    logPred.push(Math.log(predictMcap(held.tvl_usd, held.category, fit)));
  }
  const logRes = live.map((c, i) => Math.abs(Math.log(c.mcap_usd) - logPred[i]!));
  let covered = 0;
  const factors: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const others = logRes.filter((_, j) => j !== i).sort((a, b) => a - b);
    const idx = Math.min(others.length - 1, Math.ceil((others.length + 1) * level) - 1);
    const q = others[idx]!;
    factors.push(Math.exp(q));
    if (logRes[i]! <= q) covered++;
  }
  factors.sort((a, b) => a - b);
  return {
    n: live.length,
    level,
    coverage: round4(covered / Math.max(1, live.length)),
    median_interval_factor: round2(medianOf(factors) ?? 0),
  };
}

/** A deterministic generator: the same seed always deals the same resamples. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bootstrap: how much the top 10 moves when the comparables are resampled. */
export interface BootstrapResult {
  rounds: number;
  top10_overlap_mean: number;
  top10_rank_shift_mean: number;
  rank1_stays_share: number;
}

export function bootstrapTop10(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  rounds = 200,
  seed = 20261114,
): BootstrapResult {
  const live = liveComparables(snapshot, model);
  const base = buildBoard(snapshot, model);
  const baseTop = base.board.slice(0, 10).map((r) => r.slug);
  const baseRank = new Map(base.board.map((r) => [r.slug, r.rank]));
  const rand = mulberry32(seed);
  let overlapSum = 0;
  let shiftSum = 0;
  let rank1Stays = 0;
  for (let k = 0; k < rounds; k++) {
    const sample: LiveComp[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rand() * live.length)]!);
    const fit = fitCurveFromList(sample, model);
    const resampled = buildBoard(snapshot, model, fit);
    const top = resampled.board.slice(0, 10).map((r) => r.slug);
    const topSet = new Set(top);
    let overlap = 0;
    for (const slug of baseTop) if (topSet.has(slug)) overlap++;
    overlapSum += overlap;
    if (top[0] === baseTop[0]) rank1Stays++;
    const rankOf = new Map(resampled.board.map((r) => [r.slug, r.rank]));
    for (const slug of baseTop) shiftSum += Math.abs((rankOf.get(slug) ?? base.board.length) - baseRank.get(slug)!);
  }
  return {
    rounds,
    top10_overlap_mean: round2(overlapSum / rounds),
    top10_rank_shift_mean: round2(shiftSum / (rounds * baseTop.length)),
    rank1_stays_share: round4(rank1Stays / rounds),
  };
}

/** The whole validation report: what the model was tested on, and what it scored. */
export interface ValidationReport {
  model_version: string;
  live_comparables_n: number;
  loocv: LoocvResult;
  time_split: TimeSplitResult;
  walk_forward: WalkForwardResult;
  leave_one_category_out: LeaveOneCategoryOutResult;
  conformal: ConformalResult;
  bootstrap: BootstrapResult;
  read: string;
}

/** Run all six tests and write the report a reader can check. */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): ValidationReport {
  const live = liveComparables(snapshot, model);
  const loocv = leaveOneOut(snapshot, model);
  const split = timeSplit(snapshot, model);
  const walk = walkForward(snapshot, model);
  const loco = leaveOneCategoryOut(snapshot, model);
  const conf = conformalJackknife(snapshot, model);
  const boot = bootstrapTop10(snapshot, model);
  const factor = Math.max(1, Math.round(loocv.median_error_multiple));
  return {
    model_version: 'radar-5',
    live_comparables_n: live.length,
    loocv,
    time_split: split,
    walk_forward: walk,
    leave_one_category_out: loco,
    conformal: conf,
    bootstrap: boot,
    read: [
      `Leave-one-out on ${loocv.n} live-token protocols: the median prediction is off by x${loocv.median_error_multiple} (mean x${loocv.mean_error_multiple}); ${Math.round(loocv.within_2x * 100)}% land within 2x of the true market cap, ${Math.round(loocv.within_3x * 100)}% within 3x.`,
      `Time-split: fitted on ${split.n_train} protocols listed before ${split.cut_date}, tested blind on ${split.n_test} newer listings; the median prediction is off by x${split.median_error_multiple}, ${Math.round(split.within_2x * 100)}% within 2x.`,
      `Walk-forward: starting from the 30 earliest listings and growing the window by 10, every one of the ${walk.n_test} dated protocols was predicted once as a future listing; the median prediction is off by x${walk.median_error_multiple}, ${Math.round(walk.within_2x * 100)}% within 2x.`,
      `Leave-one-category-out on ${loco.n_categories} categories: a whole category predicted blind, with no offset of its own; the median prediction is off by x${loco.median_error_multiple}, ${Math.round(loco.within_2x * 100)}% within 2x.`,
      `Conformal 90% intervals (jackknife+): the true market cap lands inside its interval for ${Math.round(conf.coverage * 100)}% of the ${conf.n} live protocols; the median interval spans a factor of x${conf.median_interval_factor}.`,
      `Bootstrap (${boot.rounds} resamples of the live comparables): the top 10 keeps ${boot.top10_overlap_mean} of its 10 rows on average, each top-10 row moves ${boot.top10_rank_shift_mean} ranks, and rank 1 stays rank 1 in ${Math.round(boot.rank1_stays_share * 100)}% of resamples.`,
      `The size curve is a pricing kernel, not a price: the median protocol is mispriced by a factor of ${factor}, so a row is a candidate to research, never a valuation to trade on.`,
    ].join(' '),
  };
}
