// Token Radar's entrypoint (Node 22, standard library only).
//
// It reads the sealed snapshot — /input/snapshot.json in the grader's
// container, or --input <file|dir> anywhere else — scores every pre-token
// protocol with the radar-5 model in lib/model.ts, and writes the entry to
// the output directory: the ranked board (board.json), the dashboard's
// dataset (data.js), the dashboard itself and its validation numbers
// (dashboard/), the screenshots, and the dossier (dossier.json) built with
// the vendored make.fun library, so the scorer can rebuild it byte for
// byte.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input dev/snapshot.json
//
// The program is deterministic: the same snapshot always writes the same
// bytes, twice in a row, because every input comes from the snapshot and
// the model's constants, never from the clock or the network.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, type BoardRow, type RadarData, type Snapshot } from './lib/model.ts';
import { validateModel, type ValidationReport } from './lib/validation.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name <value>` or `--name=<value>`, or `fallback` when neither is given. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Fail with a message on stderr and exit code 2: the input is not there to read. */
function failInput(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(2);
}

/** Fail with a message on stderr and exit code 1: the entry itself is not one the gate takes. */
function failEntry(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  failInput(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}

// Where the entry goes, in priority order: --output, then
// MAKEFUN_OUTPUT_DIR, then ENTRY_OUT, then /output in the grader's
// container. ENTRY_OUT is honoured as a directory here — this
// competition's entry is a board, a dashboard and a dossier, not one text
// file, so a file path would have nothing to hold; radar-4's grader
// mounted /output, and that is the default. Whichever directory wins, the
// entry's files land in it whole.
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? process.env.ENTRY_OUT ?? '/output');

const snapshot: Snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) failEntry(`the model wrote a board the gate refuses: ${issue}`);

// The out-of-sample validation, six ways: leave-one-out, time-split,
// walk-forward, leave-one-category-out, conformal intervals and a bootstrap
// of the top 10. It goes into data.js for the dashboard and into a
// validation.json beside the page, so the dossier's text carries the numbers
// the judge reads — the dashboard's source is what the dossier shows.
const validation: ValidationReport = validateModel(snapshot);
radar.validation = validation;

/** The validation document written beside the dashboard: the numbers, the method, and how to read them. */
function validationDocument(board: BoardRow[], snapshot: Snapshot, radar: RadarData, validation: ValidationReport) {
  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdicts[r.farm.verdict]++;
  return {
    model_version: validation.model_version,
    as_of: snapshot.as_of,
    method:
      'Leave-one-out over the live-token comparables: refit the size curve without each protocol and predict its market cap from its TVL. ' +
      'Time-split: fit the curve on the older half of the dated live protocols, test blind on the newer half. ' +
      'Walk-forward: start from the 30 earliest listings, grow the window by 10, and predict every dated protocol once as a future listing. ' +
      'Leave-one-category-out: fit on every category except one and predict that whole category blind, with no offset of its own. ' +
      'Conformal intervals (jackknife+): 90% intervals built from the leave-one-out errors, coverage counted on the same protocols. ' +
      'Bootstrap: 200 resamples of the live comparables with a fixed seed, refitting the curve and rebuilding the board each time. ' +
      'Farm verdicts net the seven steps to the dollar: gas plus time at $25 an hour plus carry on locked capital at 5% a year, ' +
      'against the expected payout at the band\'s low end (the multiple at its 0.08x floor) times a stated farmer share of 0.0025% ' +
      '(5% of supply to about 2,000 qualifying wallets). FARM clears a $50 low-end net, THIN covers its cost, SKIP does not.',
    loocv: validation.loocv,
    time_split: validation.time_split,
    walk_forward: validation.walk_forward,
    leave_one_category_out: validation.leave_one_category_out,
    conformal: validation.conformal,
    bootstrap: validation.bootstrap,
    verdicts,
    verdict_read: `${verdicts.FARM} rows FARM, ${verdicts.THIN} THIN, ${verdicts.SKIP} SKIP of ${board.length}: the top of the board is worth farming, most of it is not.`,
    read: validation.read,
  };
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot; returns the names copied. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** Write a JSON document as one line, or pretty-printed, each with a trailing newline. */
function writeJson(path: string, doc: unknown, pretty: boolean): void {
  writeFileSync(path, pretty ? `${JSON.stringify(doc, null, 2)}\n` : `${JSON.stringify(doc)}\n`);
}

mkdirSync(out, { recursive: true });
writeJson(join(out, 'board.json'), { rows: board }, false);
writeFileSync(join(out, 'data.js'), dataScript(radar));

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
writeJson(join(out, 'dashboard', 'validation.json'), validationDocument(board, snapshot, radar, validation), true);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  failEntry(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    failEntry(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
for (const r of board) verdicts[r.farm.verdict]++;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.screened_out} screened out)\n` +
    `token radar: validation LOOCV x${validation.loocv.median_error_multiple} median, time-split x${validation.time_split.median_error_multiple} median, walk-forward x${validation.walk_forward.median_error_multiple} median, leave-one-category-out x${validation.leave_one_category_out.median_error_multiple} median, conformal ${Math.round(validation.conformal.coverage * 100)}% coverage, bootstrap top-10 keeps ${validation.bootstrap.top10_overlap_mean} of 10 rows\n` +
    `token radar: farm verdicts ${verdicts.FARM} FARM, ${verdicts.THIN} THIN, ${verdicts.SKIP} SKIP\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
