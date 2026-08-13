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
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Everything between these markers is written by hand — the ledger of claims
// from field reports, with verdicts. This script regenerates the rest of the
// file from telemetry, so without this the first `npm run triage` after
// someone writes a ledger would silently destroy it. Which would be a poor
// showing for a file whose entire purpose is that findings do not get lost.
const MANUAL_BEGIN = '<!-- BEGIN manual ledger -->';
const MANUAL_END = '<!-- END manual ledger -->';

function carryOverManualLedger(file) {
  if (!existsSync(file)) return null;
  const prev = readFileSync(file, 'utf8');
  const from = prev.indexOf(MANUAL_BEGIN);
  const to = prev.indexOf(MANUAL_END);
  if (from === -1 || to === -1 || to < from) return null;
  return prev.slice(from, to + MANUAL_END.length);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { readEntries, groupFailures, frictionPath } = await import(resolve(ROOT, 'out/mcp/friction.js'));

const outFile = resolve(process.argv[2] ?? resolve(ROOT, 'FRICTION.md'));
const entries = readEntries();
const failures = groupFailures(entries);
const findings = entries.filter(e => e.kind === 'finding');
const path = frictionPath();
const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
const ago = ts => `${Math.round((Date.now() / 1000 - ts) / 86400)}d ago`;

const lines = [];
lines.push('# Friction triage\n');
lines.push(`_Generated ${when} UTC from ${entries.length} entries at \`${path ?? '(not recording)'}\`._\n`);
lines.push(`
Every row below is a **candidate, not a finding**. Re-test each against a live
gateway and record a verdict:

- **confirmed** — reproduced here; safe to act on
- **refuted** — tested and did not hold. **Leave the row in.** An undocumented
  refutation gets re-adopted by whoever reads the original report next
- **untested** — plausible but unverified; must not reach a tool description or
  the server instructions

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
    lines.push(`| untested | ${g.count} | \`${g.tool}\` | ${ago(g.lastSeen)} | ${g.example.replace(/\|/g, '\\|').slice(0, 110)} |`);
  }
  lines.push('');
}

lines.push(`\n## Submitted findings — ${findings.length}\n`);
if (findings.length === 0) {
  lines.push('\n_None. Agents can add one with the `report_finding` tool._\n');
} else {
  for (const f of findings.reverse()) {
    lines.push(`\n### \`${f.tool}\` — ${ago(f.at)}\n`);
    lines.push('\n**Verdict:** untested\n');
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

writeFileSync(outFile, lines.join('\n'));
console.log(`Wrote ${outFile}`);
console.log(`  ${failures.length} recurring failure group(s), ${findings.length} submitted finding(s)`);
if (!path) console.log('  NOTE: telemetry is not recording — see hc3://friction for why.');
