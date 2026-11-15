#!/usr/bin/env node
// Turn the friction log into a triage checklist.
//
// The output is deliberately NOT a list of fixes. Every item is a candidate
// that must be re-tested against a live gateway before it changes code or a
// description. Three claims adopted from plausible reports had to be reversed
// in a single week here — the palette-PNG requirement, import_quickapp's
// server-side path, and the single-image icon model — so an item without a
// verdict is not evidence of anything.
//
// Refuted items stay in the file on purpose. A refutation that is not written
// down gets re-adopted by the next person to read the original report.
//
//   node scripts/friction-triage.mjs [outfile]     # default: FRICTION.md

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { scrub, loadScrubRules } from './friction-scrub.mjs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// Everything between these markers is written by hand — the ledger of claims
// from field reports, with verdicts. This script regenerates the rest of the
// file from telemetry, so without this the first `npm run triage` after
// someone writes a ledger would silently destroy it. Which would be a poor
// showing for a file whose entire purpose is that findings do not get lost.
const MANUAL_BEGIN = '<!-- BEGIN manual ledger -->';
const MANUAL_END = '<!-- END manual ledger -->';

// The header records which log a generation came from. The telemetry log is
// per-machine — /var/lib/hc3-mcp on the deployed unit, ~/.hc3-mcp on a laptop —
// so running triage on the wrong one replaces real signal with whatever the
// local machine happens to hold, and the generated half of the file is gone
// with no diff to explain it. Read the previous source and refuse the mismatch.
const SOURCE_LINE = /^_Generated .*? from \d+ entries at `([^`]+)`\._/m;

/**
 * Collapse the operator's home directory to `~`.
 *
 * FRICTION.md is committed and ships in the package, so the header has to
 * record WHICH log a generation came from without publishing the username and
 * home layout of whoever ran it. `~/.hc3-mcp/friction.jsonl` carries exactly
 * the same information as `/Users/someone/.hc3-mcp/friction.jsonl` and none of
 * the disclosure — the same reasoning that replaced a real LAN layout with the
 * documentation range in 4.24.0.
 *
 * Applied to the PREVIOUS header as well as the new one, and to the value the
 * mismatch guard compares. Collapsing only the written form would make every
 * run on a laptop compare `~/...` against a stored `/Users/...` and demand
 * --force for a purely cosmetic difference, which trains people to pass
 * --force by reflex — and that flag exists to stop one machine's telemetry
 * silently replacing another's.
 */
function tildify(p) {
  if (!p) return p;
  const home = homedir();
  if (!home) return p;
  if (p === home) return '~';
  return p.startsWith(home + sep) ? '~' + p.slice(home.length) : p;
}

function previousSource(file) {
  if (!existsSync(file)) return null;
  const m = readFileSync(file, 'utf8').match(SOURCE_LINE);
  return m ? m[1] : null;
}

function carryOverManualLedger(file) {
  if (!existsSync(file)) return null;
  const prev = readFileSync(file, 'utf8');
  const from = prev.indexOf(MANUAL_BEGIN);
  const to = prev.indexOf(MANUAL_END);
  if (from === -1 || to === -1 || to < from) return null;
  return prev.slice(from, to + MANUAL_END.length);
}

/**
 * The script is STRICTER than the resource about a malformed verdicts file.
 *
 * `loadVerdicts` in friction.ts degrades to "no verdicts" on any read or parse
 * failure, which is right for a live resource: an unreadable side file must
 * not take out hc3://friction. But this script WRITES a committed document,
 * and silently regenerating every row back to `untested` because of a stray
 * comma is exactly the misreporting this whole feature exists to stop. So
 * check the file parses before using the shared loader.
 */
function assertVerdictsReadable(root) {
  const file = resolve(root, 'friction-verdicts.json');
  if (!existsSync(file)) {
    console.log(`  no ${file} — every row will render as untested`);
    return;
  }
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Refusing to regenerate: ${file} is present but will not parse — ${e.message}\n\n` +
      'Every row would silently drop back to `untested`, which is the misreporting\n' +
      'this file exists to prevent. Fix the JSON and run again.');
    process.exit(1);
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {
  readEntries, groupFailures, frictionPath,
  loadVerdicts, matchFailureVerdict, matchFindingVerdict,
  verdictLabel, verdictContradicted, verdictSuspect,
} = await import(resolve(ROOT, 'out/mcp/friction.js'));

const argv = process.argv.slice(2).filter(a => a !== '--force');
const force = process.argv.includes('--force');
const outFile = resolve(argv[0] ?? resolve(ROOT, 'FRICTION.md'));
const entries = readEntries();
const failures = groupFailures(entries);
const findings = entries.filter(e => e.kind === 'finding');
const path = frictionPath();
assertVerdictsReadable(ROOT);
const verdicts = loadVerdicts(ROOT);
const usedVerdicts = new Set();

const source = tildify(path) ?? '(not recording)';
const previous = tildify(previousSource(outFile));
if (previous && previous !== source && !force) {
  console.error(
    `Refusing to regenerate ${outFile}.\n\n` +
    `  it was generated from: ${previous}\n` +
    `  this machine records to: ${source}\n\n` +
    'Those are different logs, so this run would replace one machine\'s recorded\n' +
    'friction with another\'s — silently, since the hand-written ledger is carried\n' +
    'across and only the generated half changes. Run it where the telemetry lives\n' +
    '(the deployed unit, normally), or pass --force if replacing it is the intent.'
  );
  process.exit(1);
}
const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
const ago = ts => `${Math.round((Date.now() / 1000 - ts) / 86400)}d ago`;

const lines = [];
lines.push('# Friction triage\n');
lines.push(`_Generated ${when} UTC from ${entries.length} entries at \`${source}\`._\n`);
lines.push(`
Every row below is a **candidate, not a finding**. Re-test each against a live
gateway and record a verdict:

- **confirmed** — reproduced here; safe to act on
- **refuted** — tested and did not hold. **Leave the row in.** An undocumented
  refutation gets re-adopted by whoever reads the original report next
- **untested** — plausible but unverified; must not reach a tool description or
  the server instructions
- **by-design** — not a defect. The tool saw a call it knew was wrong and
  refused it. Recorded because calling a working guard an untested candidate
  wastes the same pass as calling a fixed bug one

Verdicts come from \`friction-verdicts.json\`; a row with no entry there reads
\`untested\`, which is the safe default rather than a claim. **⚠ SEEN SINCE ON
x.y.z** means the failure was recorded BY a build that already contained its
claimed fix, so the verdict is wrong and the telemetry is right. That check
needs the version stamped on the entry (4.31.0 onward); for older entries a
date-only discrepancy is reported on the console instead, because a release
date cannot tell a failed fix apart from a gateway that had not been updated
yet.

\`scripts/probe.mjs\` provides throwaway objects with guaranteed teardown and a
\`single()\` helper for one-variable tests, which is the bar a candidate has to
clear to become a finding.
`);

lines.push(`\n## Recurring failures — ${failures.length} distinct\n`);
if (failures.length === 0) {
  lines.push('\n_None recorded._\n');
} else {
  lines.push(`
A tool failing the same way repeatedly is usually a missing or wrong
description rather than user error. High counts against one tool are the
cheapest wins available.
\n`);
  lines.push('| Verdict | Count | Tool | Last | Message |');
  lines.push('|---|---|---|---|---|');
  for (const g of failures.slice(0, 40)) {
    const v = matchFailureVerdict(verdicts.failures, g);
    if (v) usedVerdicts.add(v);
    const note = v?.note ? ` <br>_${v.note.replace(/\|/g, '\\|')}_` : '';
    lines.push(`| ${verdictLabel(v, g)} | ${g.count} | \`${g.tool}\` | ${ago(g.lastSeen)} | ${g.example.replace(/\|/g, '\\|').slice(0, 110)}${note} |`);
  }
  lines.push('');
}

lines.push(`\n## Submitted findings — ${findings.length}\n`);
if (findings.length === 0) {
  lines.push('\n_None. Agents can add one with the `report_finding` tool._\n');
} else {
  for (const f of findings.reverse()) {
    const v = matchFindingVerdict(verdicts.findings, f);
    if (v) usedVerdicts.add(v);
    lines.push(`\n### \`${f.tool}\` — ${ago(f.at)}\n`);
    lines.push(`\n**Verdict:** ${verdictLabel(v)}\n`);
    if (v?.note) lines.push(`\n_${v.note}_\n`);
    lines.push(`\n**Expected:** ${f.finding?.expected}\n`);
    lines.push(`\n**Actual:** ${f.finding?.actual}\n`);
    lines.push(`\n**Reproduction:**\n\n${f.finding?.reproduction}\n`);
    if (f.finding?.impact) lines.push(`\n**Cost:** ${f.finding.impact}\n`);
    if (f.finding?.reporter) lines.push(`\n_Reported by ${f.finding.reporter}_\n`);
  }
}

const manual = carryOverManualLedger(outFile);
if (manual) {
  lines.push('\n' + manual + '\n');
} else {
  lines.push(`
${MANUAL_BEGIN}

## Claim ledger

_None yet. Claims that arrive by field report rather than through telemetry go
here, one row each, with a verdict. Anything written between the two markers
survives regeneration; anything outside them does not._

${MANUAL_END}
`);
}

lines.push(`
## Where a confirmed item goes

| Scope | Home |
|---|---|
| Applies to one tool | that tool's description |
| Cuts across tools, unguessable, and costly | server instructions — but only if verified here; the bar is higher because every session pays for it |
| A behaviour of HC3 rather than this server | the description of whichever tool a caller hits it through |
| Refuted | stays in this file, marked refuted, with the evidence |
`);

// Public file: strip names, the home's name and LAN addresses (friction-scrub.mjs).
writeFileSync(outFile, scrub(lines.join('\n'), loadScrubRules()));
console.log(`Wrote ${outFile}`);
console.log(`  ${failures.length} recurring failure group(s), ${findings.length} submitted finding(s)`);
if (verdicts.present) {
  const all = [...verdicts.failures, ...verdicts.findings];
  const unused = all.filter(v => !usedVerdicts.has(v));
  console.log(`  ${all.length - unused.length}/${all.length} verdict(s) matched a row`);
  // Not an error: the log rotates, and a verdict outliving its rows is normal.
  // Worth naming so the register can be pruned deliberately rather than rotting.
  for (const v of unused) {
    console.log(`  unmatched verdict: ${v.tool} — ${v.signature ?? v.signatureContains ?? `at ${v.at}`}`);
  }
  for (const g of failures) {
    const v = matchFailureVerdict(verdicts.failures, g);
    if (verdictContradicted(v, g)) {
      console.log(`  WARNING: ${g.tool} is marked fixed in ${v.resolvedIn} but was recorded BY ${g.lastVersion} — the verdict is wrong`);
    } else if (verdictSuspect(v, g)) {
      console.log(`  note: ${g.tool} is marked fixed in ${v.resolvedIn} but was seen ${ago(g.lastSeen)}, after that release. The entry predates version stamping, so this is probably deploy lag rather than a failed fix — confirm before acting.`);
    }
  }
} else {
  console.log('  no friction-verdicts.json — every row rendered as untested');
}
if (!path) console.log('  NOTE: telemetry is not recording — see hc3://friction for why.');
