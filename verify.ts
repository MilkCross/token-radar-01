// Build-time verification: node verify.ts [--input <snapshot.json>] [--kit <starter vendor file>]
//
// Runs main.ts twice into two fresh directories and checks, each line printed pass or FAIL, that: every output file is
// byte-identical across the runs; the dashboard is within the scorer's 65,536-byte text cap; the dossier is within 1.5 MiB;
// each screenshot is a whole PNG within 512 KiB; no output or source file holds an http(s):// address or an xmlns string; no
// source file holds a protocol's slug as a string literal; and the vendored library is byte-identical to the kit's copy and
// to the committed one. Exit status 1 if any line fails.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { literalNameHits, parseSnapshot } from './lib/model.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback;
};
const input = arg('input', '/input/snapshot.json');
const kitVendor = arg('kit', join(process.env.HOME ?? '', 'workspace/makefun-token-radar/kit/token-radar-01-kit/starter/vendor/makefun-board.ts'));

const DASHBOARD_MAX = 65_536;
const DOSSIER_MAX = 1.5 * 1024 * 1024;
const SHOT_MAX = 524_288;

/** Every regular file under a directory, as relative path -> bytes. */
function tree(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.set(relative(dir, path), readFileSync(path));
    }
  };
  walk(dir);
  return out;
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex').slice(0, 12);

const results: { ok: boolean; label: string; detail: string }[] = [];
const line = (ok: boolean, label: string, detail: string): void => { results.push({ ok, label, detail }); };

const dirs = [mkdtempSync(join(tmpdir(), 'radar-a-')), mkdtempSync(join(tmpdir(), 'radar-b-'))];
const times: number[] = [];
for (const d of dirs) {
  const t = Date.now();
  execFileSync('node', [join(here, 'main.ts'), '--input', input, '--output', d], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 });
  times.push((Date.now() - t) / 1000);
}
const [a, b] = dirs.map(tree) as [Map<string, Buffer>, Map<string, Buffer>];
const diff = [...new Set([...a.keys(), ...b.keys()])].filter((k) => !a.get(k)?.equals(b.get(k) ?? Buffer.alloc(0)) || !b.has(k));
line(diff.length === 0 && a.size > 0, 'two runs byte-identical', `${a.size} files, ${diff.length} differ${diff.length ? ` (${diff.join(', ')})` : ''}; run times ${times.map((t) => t.toFixed(1)).join(' s, ')} s; dossier sha ${sha(a.get('dossier.json') ?? Buffer.alloc(0))}`);

const dash = [...a].filter(([k]) => k.startsWith('dashboard/'));
const dashBytes = dash.reduce((n, [, v]) => n + v.length, 0);
line(dashBytes <= DASHBOARD_MAX, 'dashboard within text cap', `${dashBytes} of ${DASHBOARD_MAX} bytes (${dash.map(([k, v]) => `${k.slice(10)} ${v.length}`).join(', ')})`);

const dossier = a.get('dossier.json')?.length ?? 0;
line(dossier > 0 && dossier <= DOSSIER_MAX, 'dossier within 1.5 MiB', `${dossier} of ${DOSSIER_MAX} bytes`);

const shots = [...a].filter(([k]) => k.startsWith('screenshots/'));
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
line(shots.length >= 3 && shots.length <= 4 && shots.every(([, v]) => v.length <= SHOT_MAX && v.subarray(0, 8).equals(png)), 'screenshots whole PNGs within 512 KiB', shots.map(([k, v]) => `${k.slice(12)} ${v.length}`).join(', '));

// No web address and no namespace string anywhere an entry ships: the output tree and the sources.
const sources = ['main.ts', 'lib/model.ts', 'verify.ts', 'dashboard/app.js', 'dashboard/app.css', 'dashboard/index.html'];
const WEB = /https?:\/\/|xmlns/i;
const web: string[] = [];
for (const [k, v] of a) if (WEB.test(v.toString('latin1'))) web.push(`out/${k}`);
for (const s of sources) if (s !== 'verify.ts' && WEB.test(readFileSync(join(here, s), 'utf8'))) web.push(s);
line(web.length === 0, 'no http(s):// or xmlns', web.length ? `found in ${web.join(', ')}` : `${a.size} output files and ${sources.length - 1} sources scanned`);

// No protocol name hardcoded: every snapshot slug against every string literal of the code.
const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
const slugs = new Set(snapshot.protocols.map((p) => p.slug));
const names = new Set(snapshot.protocols.map((p) => p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')));
let literals = 0;
const hits: string[] = [];
const coincidences: string[] = [];
for (const s of ['main.ts', 'lib/model.ts', 'dashboard/app.js']) {
  const r = literalNameHits(readFileSync(join(here, s), 'utf8'), slugs, names);
  literals += r.literals;
  hits.push(...r.hits.map((h) => `${s}: ${h}`));
  coincidences.push(...r.coincidences.map((h) => `${s}: ${h}`));
}
const control = literalNameHits("const a = 'sample-slug';", new Set(['sample-slug']), new Set()).hits.length === 1;
line(hits.length === 0 && control, 'no hardcoded protocol names', `${literals} string literals against ${slugs.size} slugs: ${hits.length} hits${hits.length ? ` (${hits.join(', ')})` : ''}; positive control ${control ? 'ok' : 'FAILED'}; name-only coincidences: ${coincidences.join(', ') || 'none'}`);

// The vendored library is the kit's, unmodified, and the committed copy.
const vendor = readFileSync(join(here, 'vendor/makefun-board.ts'));
const kitOk = existsSync(kitVendor) && readFileSync(kitVendor).equals(vendor);
let headOk = false;
try { headOk = execFileSync('git', ['-C', here, 'show', 'HEAD:vendor/makefun-board.ts'], { maxBuffer: 16 << 20 }).equals(vendor); } catch { /* no git history */ }
line(kitOk && headOk, 'vendor file byte-identical', `sha ${sha(vendor)}; kit copy ${kitOk ? 'same' : 'DIFFERENT or missing'}; committed copy ${headOk ? 'same' : 'DIFFERENT or missing'}`);

for (const d of dirs) rmSync(d, { recursive: true, force: true });
for (const r of results) process.stdout.write(`[${r.ok ? 'pass' : 'FAIL'}] ${r.label}: ${r.detail}\n`);
const failed = results.filter((r) => !r.ok).length;
process.stdout.write(failed === 0 ? `verify: all ${results.length} checks pass\n` : `verify: ${failed} of ${results.length} checks FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
