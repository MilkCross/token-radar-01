// A working token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. A starting
// point, not a winner: it covers the watchlist, states the model and gives every protocol a farm plan.
// Change the model, the page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, calibrationSummary, coverageSummary, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
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

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const dashBytes = dashFiles.reduce((n, f) => n + statSync(join(out, 'dashboard', f)).size, 0);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > SCREENSHOT_CAPS.max) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'} (the gate takes 3 to ${SCREENSHOT_CAPS.max}): hand in 3 or 4, the board, a detail view, a filtered view and optionally one more\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
writeFileSync(join(out, 'dossier.json'), dossier);

// The self-check a run prints: watchlist coverage, verdicts (original rows apart from promoted ones), set-aside audit,
// validation ladder, bands, sizes and the integrity checks.
const slugs = new Set(board.map((r) => r.slug));
const onBoard = snapshot.watchlist.filter((w) => slugs.has(w)).length;
const promotedSlugs = new Set(radar.rows.filter((r) => r.promoted).map((r) => r.slug));
const tally = (rows: typeof board): string => {
  const verdicts: Record<string, number> = {};
  for (const r of rows) {
    const label = r.farm_verdict.split(':')[0]!;
    verdicts[label] = (verdicts[label] ?? 0) + 1;
  }
  return Object.entries(verdicts).map(([k, v]) => `${k} ${v}`).join(', ');
};
const usd = (n: number): string => `$${n.toLocaleString('en-US')}`;
const top5 = radar.rows.slice(0, 5).map((r) => `#${r.rank} ${r.name} ${usd(r.implied_value_usd)}, odds ${Math.round(r.launch_odds * 100)}%, band ${usd(r.value_low)} to ${usd(r.value_high)}`).join('\n  ');
const lad = radar.fit.ladder;
const f3 = (n: number): string => n.toFixed(3);
const ladderTable = [
  `  ${'variant'.padEnd(42)}${lad.schemes.map((x) => x.padStart(14)).join('')}   (n ${lad.n.join('/')})`,
  ...lad.rows.map((r) => `  ${r.label.padEnd(42)}${r.errors.map((e) => f3(e).padStart(14)).join('')}   vs naive ${r.vs_naive.map(f3).join('/')}, level (sum predicted / sum actual) ${r.level.map(f3).join('/')}`),
].join('\n');
const termLines = lad.terms.map((t) => `  ${t[0].padEnd(20)}LOO ${f3(t[1])} (${t[3] >= 0 ? '+' : ''}${f3(t[3])}), walk-forward ${f3(t[2])} (${t[4] >= 0 ? '+' : ''}${f3(t[4])}): ${t[5]}`).join('\n');
const thinRows = radar.rows.filter((r) => r.thin);
const cappedRows = radar.rows.filter((r) => r.verdict_capped);
const x = radar.odds.experiment;
const promotedLines = radar.rows.filter((r) => r.promoted).map((r) => `  #${r.rank} ${r.name} (${r.category ?? 'Uncategorized'}, TVL ${usd(r.tvl_usd)}, ${r.chains.length} chains): ${usd(r.implied_value_usd)}, range ${usd(r.value_low)} to ${usd(r.value_high)}, ${r.farm_verdict.split(':')[0]}. ${r.why}`).join('\n');
const quarantineLines = radar.quarantined.map((q) => `  ${q.name} (${q.slug}): ${q.reason}`).join('\n');
const failed = radar.integrity.filter((c) => c.pass === false);

process.stdout.write(
  `token radar: ${calibrationSummary(radar)}\n` +
    `token radar: ${coverageSummary(radar)}\n` +
    `token radar: watchlist coverage ${onBoard}/${snapshot.watchlist.length}; verdicts, original rows ${tally(board.filter((r) => !promotedSlugs.has(r.slug)))}; promoted rows ${tally(board.filter((r) => promotedSlugs.has(r.slug)))}; reconciliation ${radar.recon.rows} rows, sum ${usd(radar.recon.sum_implied_usd)}, build ${radar.recon.build}\n` +
    `token radar: THIN rule, ${thinRows.length} of ${board.length} rows in categories under 3 peers; the Marginal cap changed ${cappedRows.length} verdicts (Worth it to Marginal)\n` +
    `token radar: validation ladder, median abs log error (leakage-free refits, k tuned inside every fold)\n${ladderTable}\n` +
    `  shipped-model terms at fixed k = ${radar.fit.k} (reference LOO ${f3(lad.reference[0]!)}, walk-forward ${f3(lad.reference[1]!)}; change in error, + means removal hurts)\n${termLines}\n` +
    `  band coverage, walk-forward with bands from the training part alone: 50% band ${(radar.fit.band.coverage * 100).toFixed(1)}% (${radar.fit.band.inside}/${radar.fit.band.n}); 80% band ${(radar.fit.band80.coverage * 100).toFixed(1)}% (${radar.fit.band80.inside}/${radar.fit.band80.n})\n` +
    `  ${lad.note}\n` +
    `token radar: odds test, smoothing ${x.variant} vs ${x.current}: Brier ${x.brier_variant} vs ${x.brier_current}, tolerance +${x.tolerance}: ${x.adopted ? 'ADOPTED' : 'REJECTED'}\n` +
    `token radar: set-aside audit, ${radar.promoted_size} promoted, ${radar.quarantined.length} quarantined\n${promotedLines}${quarantineLines === '' ? '' : `\n${quarantineLines}`}\n` +
    `token radar: top 5\n  ${top5}\n` +
    `token radar: dashboard source ${dashBytes} bytes, dossier ${Buffer.byteLength(dossier)} bytes with ${shots.length} screenshots\n` +
    `token radar: integrity\n${radar.integrity.map((c) => `  [${c.pass === null ? 'info' : c.pass ? 'pass' : 'FAIL'}] ${c.label}: ${c.value}`).join('\n')}\n` +
    (failed.length > 0 ? `token radar: INTEGRITY FAILED: ${failed.map((c) => c.label).join(', ')}\n` : `token radar: all ${radar.integrity.filter((c) => c.pass !== null).length} integrity checks pass\n`) +
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.promoted_size} promoted, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
