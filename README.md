[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

[![rank](https://make.fun/badge/token-radar-01/yudhisutawan77/token-radar-5/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

[![reward](https://make.fun/badge/token-radar-01/yudhisutawan77/token-radar-5/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Launch Radar v5: fitted on launches, tested held-out four ways (LOOCV x2.86, walk-forward x2.02, conformal 90%)

A launch radar for make.fun's **Build the best token launch radar** bounty
(`token-radar-01`, $1,325 in escrow, 10 places paid).

It starts from a sealed DefiLlama snapshot of 758 protocols, picks out the
ones with no token on record that are not a wrapped, staked or bridged
spin-off of something that already trades, prices each one off the live
market, and ships a dashboard a reader can actually use: a ranked board, a
detail view for every protocol, and a filter — each row with a farm plan
and a farm verdict costed to the dollar, and the model itself put through
out-of-sample tests before it is trusted.

## What changed from radar-4

Radar-4 (provisional 91.31%, LOOCV x2.91, time-split x2.64) is the baseline
this version is judged against, in the same local validation, on the same
snapshot. Two changes survived blind testing; everything else that was
tried was dropped on the evidence.

- **Exchange tokens stay out of the fit.** Their multiples price the
  exchange's revenue, not the protocol's TVL — the same kind of category
  screen the board itself applies. The fit runs on the remaining live-token
  protocols. On its own this moves the forward tests most: time-split
  x2.64 → x2.20, walk-forward x2.28 → x2.14, LOOCV x2.91 → x2.87.
- **Category offsets are shrunk harder: 16 pseudo-observations, not 8.**
  A category with a single live protocol no longer inherits that
  protocol's offset wholesale. This was the best shrink in two independent
  rounds of testing (4 and 8 both worse).

Dropped, with the numbers that killed them: adding log age to the curve
(forward tests wrecked, walk-forward x2.59–3.03, and the apparent LOOCV
gain was an imputation constant, not signal); fitting only on protocols
that pass the launch screen (forward tests x2.02/x2.05 but the headline
LOOCV falls to x3.47); Huber loss, chain counts, seven-day change as a
feature, quadratic terms, ensembles, Theil-Sen, trimmed OLS, LAD, kNN and
local-linear fits (each mixed, unstable, or worse on the headline).

## The model

One function scores every protocol. No name is special-cased, and no row is
hand-picked.

- **Size curve**, fitted on the live-token protocols in the snapshot with
  exchange tokens excluded: `ln(market cap) = 4.847 + 0.660 x ln(TVL)`,
  plus one offset per category — the mean residual of its live protocols,
  shrunk toward zero with 16 pseudo-observations.
- **Implied value** = the curve's prediction at the protocol's own TVL,
  clamped to a 0.08x–1.20x multiple, times a growth factor from the
  seven-day TVL change (0.6x the change, clamped to −50%…+100%), times a
  maturity factor that rises from 0.70 for a protocol listed today to 1.00
  at three years, times a 0.85 pre-token discount.
- **Screen**: a pre-token protocol reaches the board only if it is not a
  wrapped, staked or bridged product of a token that trades, has at least
  $5M of TVL, and is at least 7 days old. 144 protocols fail the screen.
- **Farm plan**: seven steps per row — fresh wallet, a $150 deposit and a
  $25 second position on the protocol's own chain, one qualifying action a
  week, 30 days open — costed to the dollar (gas + time at $25 an hour +
  carry on locked capital at 5% a year) and netted against the expected
  payout at the band's low end times a stated farmer share of 0.0025%
  (5% of supply to about 2,000 qualifying wallets). FARM clears a $50
  low-end net, THIN covers its cost, SKIP does not. 39 rows FARM, 19 THIN,
  140 SKIP of 198.

## Validation — four held-out ways, one conformal interval

All six tests run on the same snapshot, in `lib/validation.ts`, and are
written into `dashboard/validation.json` and the dossier with every run.

| Test | radar-5 | radar-4 |
| --- | ---: | ---: |
| Leave-one-out, median error | **x2.86** | x2.91 |
| Time-split, median error | **x2.09** | x2.64 |
| Walk-forward, median error | **x2.02** | x2.28 |
| Leave-one-category-out, median error | x3.19 | x3.15 |
| Conformal 90% intervals, coverage | **90.8%** (median interval factor x12.35) | 90.8% (x12.30) |
| Bootstrap top 10 (200 resamples) | 8.86 of 10 kept, rank shift 0.53 | 8.87 of 10 kept, rank shift 0.76 |

Leave-one-out refits the curve without each of the 109 live protocols and
predicts its market cap from its TVL (33% within 2x, 50% within 3x).
Time-split fits on the 41 listings before 2024-02-06 and tests blind on
the 41 newer ones (46% within 2x). Walk-forward starts from the 30
earliest listings, grows the window by 10, and predicts every one of the
52 dated protocols once as a future listing (50% within 2x).
Leave-one-category-out fits on every category except one and predicts
that whole category blind, with no offset of its own (32% within 2x).
The conformal intervals are jackknife+ built from the leave-one-out
errors: the true market cap lands inside its 90% interval for 90.8% of
the 109 protocols.

The headline LOOCV move, x2.91 → x2.86, is inside the noise of a
109-protocol median (about ±0.1). The forward-test moves are the real
ones: time-split x2.64 → x2.09 and walk-forward x2.28 → x2.02, each on
41–52 held-out predictions. The size curve is a pricing kernel, not a
price: the median protocol is mispriced by a factor of 3, so a row is a
candidate to research, never a valuation to trade on.

## What is in here

- `main.ts` — the entrypoint (Node 22, standard library only). Reads the
  snapshot, scores the board, writes `board.json`, `data.js`, `dossier.json`
  and copies `dashboard/` and `screenshots/` to the output directory.
- `lib/model.ts` — the model, the only place the ranking is computed.
- `lib/validation.ts` — the out-of-sample tests: leave-one-out, time-split,
  walk-forward, leave-one-category-out, conformal intervals, bootstrap.
- `dashboard/` — the static page (no network, no framework): `index.html`,
  `app.css`, `app.js`. `main.ts` also writes `dashboard/validation.json`
  beside the page, so the dossier's text carries the validation numbers.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied verbatim.
- `screenshots/` — three renders of the dashboard, taken with headless
  Chromium: the board, a protocol's detail view, and a filtered view.
- `dev/` — the experiment harness and the local gate replica (not part of
  the entry): `exp-radar5*.ts`, `check-model.ts`, `check-gate.mjs`,
  `shoot.mjs`, `snapshot.json`, `makefun.mjs`.

## How to run it

```sh
node main.ts --input dev/snapshot.json
```

Reads `dev/snapshot.json` (the sealed DefiLlama snapshot the grader
supplies) and writes the entry to `out/` — or to `--output <dir>`, or to
`$MAKEFUN_OUTPUT_DIR` or `$ENTRY_OUT` (both honoured as directories) when
set, or to `/output` in the grader's container.
There is no `entry.txt` for this competition: the entry is the board
(`board.json`), the dashboard, and the dossier (`dossier.json`), the same
shape radar-4 submitted and scored on. Node 22 or later, no dependencies,
no network. Two runs on the same input are byte-identical.

## The board, at a glance

198 pre-token rows: 40 from the watchlist and 158 early rows that pass the
same screen. Top implied values: Steakhouse Financial $172.8M, Sentora
Curator $169.9M, Gauntlet $125.3M, Veda $106.1M, USDD $79.4M. The board is
in `out/board.json`; open `out/dashboard/index.html` to read it.
