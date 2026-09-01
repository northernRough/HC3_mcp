#!/usr/bin/env node
// Unit test — verdicts on the friction surfaces.
//
// Both the generated FRICTION.md table and the hc3://friction resource used to
// present every row with no verdict: the file hard-coded "untested", the
// resource showed nothing at all. A documented limitation, until it became a
// defect — rows fixed in 4.19.2 and 4.21.2 were still reading as open
// candidates weeks later, and a finding whose own text began "RESOLVED IN
// 4.26.0" sat under a hard-coded untested.
//
// The subtle half is the staleness check. A verdict claiming a fix, on a row
// still occurring, should be flagged; but a RELEASE DATE cannot show that,
// because deploy lag makes every entry between release and deploy look like a
// failed fix. The first version of the check flagged two rows for exactly that
// reason and both were innocent. So a contradiction requires the version
// stamped on the entry, and a date-only discrepancy is never asserted.
//
//   node scripts/test/unit-verdicts.mjs

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const F = await import('../../out/mcp/friction.js');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

const group = (over = {}) => ({
  tool: 'get_device_property', signature: 'HTTP <n>: Not Found',
  count: 29, firstSeen: 1, lastSeen: 100, example: 'HTTP 404: Not Found', ...over,
});

// ---------------------------------------------------------------------------
// The register itself
// ---------------------------------------------------------------------------

check('the shipped register parses and is shipped', () => {
  const v = JSON.parse(readFileSync(resolve(ROOT, 'friction-verdicts.json'), 'utf8'));
  assert.ok(Array.isArray(v.failures) && v.failures.length > 0);
  // A verdict nobody can read at runtime is a verdict that does not exist.
  const files = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).files;
  assert.ok(files.includes('friction-verdicts.json'), 'not in package.json files');
});

check('every entry uses the documented vocabulary and can be matched', () => {
  const v = JSON.parse(readFileSync(resolve(ROOT, 'friction-verdicts.json'), 'utf8'));
  const allowed = new Set(['confirmed', 'refuted', 'untested', 'by-design']);
  for (const e of v.failures) {
    assert.ok(allowed.has(e.verdict), `bad verdict ${e.verdict} on ${e.tool}`);
    assert.ok(e.signature !== undefined || e.signatureContains !== undefined,
      `${e.tool} entry has no signature to match on`);
    // resolvedIn without resolvedAt cannot be date-checked; resolvedAt
    // without resolvedIn labels nothing. Require them together.
    assert.equal(e.resolvedIn === undefined, e.resolvedAt === undefined,
      `${e.tool}: resolvedIn and resolvedAt must be set together`);
  }
  for (const e of v.findings) {
    assert.ok(allowed.has(e.verdict), `bad verdict ${e.verdict}`);
    assert.equal(typeof e.at, 'number', 'findings are keyed by their `at` epoch');
  }
});

check('the register describes the live 404 rows as fixed, not as candidates', () => {
  // The concrete regression: these two are 51 of 83 recorded failures and were
  // fixed in 4.27.0, yet read `untested` for as long as the table hard-coded it.
  const v = F.loadVerdicts(ROOT);
  for (const tool of ['get_device_property', 'get_device_parameters']) {
    const m = F.matchFailureVerdict(v.failures, group({ tool }));
    assert.ok(m, `no verdict for ${tool}`);
    assert.equal(m.verdict, 'confirmed');
    assert.equal(m.resolvedIn, '4.27.0');
  }
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

check('exact and substring matching, and no cross-tool bleed', () => {
  const vs = [
    { tool: 'a', signature: 'exact one', verdict: 'confirmed' },
    { tool: 'b', signatureContains: 'middle', verdict: 'refuted' },
  ];
  assert.equal(F.matchFailureVerdict(vs, group({ tool: 'a', signature: 'exact one' }))?.verdict, 'confirmed');
  assert.equal(F.matchFailureVerdict(vs, group({ tool: 'a', signature: 'exact one plus' })), undefined);
  assert.equal(F.matchFailureVerdict(vs, group({ tool: 'b', signature: 'a middle bit' }))?.verdict, 'refuted');
  // Same signature, different tool, must not match.
  assert.equal(F.matchFailureVerdict(vs, group({ tool: 'c', signature: 'exact one' })), undefined);
});

check('findings match on epoch AND tool', () => {
  const vs = [{ tool: 'get_icon', at: 1788215794, verdict: 'confirmed' }];
  assert.ok(F.matchFindingVerdict(vs, { at: 1788215794, tool: 'get_icon' }));
  // A mistyped tool must not silently attach a verdict to the wrong finding.
  assert.equal(F.matchFindingVerdict(vs, { at: 1788215794, tool: 'upload_icon' }), undefined);
});

// ---------------------------------------------------------------------------
// Labels and the staleness check
// ---------------------------------------------------------------------------

check('no verdict reads untested, which is a default and not a claim', () => {
  assert.equal(F.verdictLabel(undefined, group()), 'untested');
});

check('a fix is named in the label', () => {
  assert.equal(
    F.verdictLabel({ verdict: 'confirmed', resolvedIn: '4.27.0' }, group({ lastVersion: '4.26.1' })),
    'confirmed, fixed 4.27.0');
  assert.equal(F.verdictLabel({ verdict: 'by-design' }, group()), 'by-design');
});

check('a row recorded BY the fixed version contradicts its verdict', () => {
  const v = { verdict: 'confirmed', resolvedIn: '4.27.0', resolvedAt: 1000 };
  assert.equal(F.verdictContradicted(v, group({ lastVersion: '4.27.0' })), true);
  assert.equal(F.verdictContradicted(v, group({ lastVersion: '4.30.0' })), true);
  assert.match(F.verdictLabel(v, group({ lastVersion: '4.30.0' })), /⚠ SEEN SINCE ON 4\.30\.0/);
});

check('a row from an older build does NOT contradict it', () => {
  const v = { verdict: 'confirmed', resolvedIn: '4.27.0', resolvedAt: 1000 };
  assert.equal(F.verdictContradicted(v, group({ lastVersion: '4.26.1' })), false);
  assert.doesNotMatch(F.verdictLabel(v, group({ lastVersion: '4.26.1' })), /SEEN SINCE/);
});

check('a date-only discrepancy is never asserted in the label', () => {
  // The deploy-lag trap. lastSeen is after the release date, but the entry
  // carries no version, so this must be reported elsewhere and NOT claimed.
  const v = { verdict: 'confirmed', resolvedIn: '4.19.2', resolvedAt: 1000 };
  const g = group({ lastSeen: 5000, lastVersion: undefined });
  assert.equal(F.verdictContradicted(v, g), false);
  assert.equal(F.verdictSuspect(v, g), true);
  assert.doesNotMatch(F.verdictLabel(v, g), /SEEN SINCE/);
  // And once the entry does carry a version, suspicion gives way to evidence.
  assert.equal(F.verdictSuspect(v, group({ lastSeen: 5000, lastVersion: '4.19.1' })), false);
});

check('version compare handles unequal part counts and double digits', () => {
  assert.ok(F.cmpVersion('4.30.0', '4.9.0') > 0, '4.30 must beat 4.9');
  assert.ok(F.cmpVersion('4.27', '4.27.0') === 0);
  assert.ok(F.cmpVersion('4.27.0', '4.27.1') < 0);
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

check('entries carry the server version, which is what makes the check possible', () => {
  const { SERVER_VERSION } = { SERVER_VERSION: JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version };
  assert.equal(typeof SERVER_VERSION, 'string');
  // groupFailures must carry the newest entry's version, not the oldest.
  const groups = F.groupFailures([
    { at: 10, kind: 'failure', tool: 't', signature: 's', message: 'm', v: '4.1.0' },
    { at: 20, kind: 'failure', tool: 't', signature: 's', message: 'm', v: '4.2.0' },
  ]);
  assert.equal(groups[0].lastVersion, '4.2.0');
  assert.equal(groups[0].count, 2);
});

check('a group of entries with no version reports none', () => {
  const groups = F.groupFailures([{ at: 10, kind: 'failure', tool: 't', signature: 's', message: 'm' }]);
  assert.equal(groups[0].lastVersion, undefined);
});

check('a missing register degrades to untested rather than throwing', () => {
  // Right for the resource: an unreadable side file must not take out
  // hc3://friction. The triage SCRIPT is stricter and refuses instead.
  const v = F.loadVerdicts('/nonexistent-path-for-this-test');
  assert.deepEqual(v, { failures: [], findings: [], present: false });
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll verdict checks passed');
process.exit(failures ? 1 : 0);
