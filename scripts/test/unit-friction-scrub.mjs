#!/usr/bin/env node
// Unit test — FRICTION.md personal-detail scrub (scripts/friction-scrub.mjs).
//   node scripts/test/unit-friction-scrub.mjs
import { strict as assert } from 'node:assert';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const { scrub, loadScrubRules, scrubRulesPath } = await import('../friction-scrub.mjs');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

check('private IPv4 becomes the documentation range; public ones stay', () => {
  assert.equal(scrub('to 10.9.8.12:60128, 192.168.4.7 and 172.20.0.9'), 'to 192.0.2.12:60128, 192.0.2.7 and 192.0.2.9');
  assert.equal(scrub('8.8.8.8 and 172.15.0.1'), '8.8.8.8 and 172.15.0.1');
});
check('local rules apply in order, including next to markdown underscores', () => {
  const dir = mkdtempSync(`${tmpdir()}/scrub-`);
  const f = `${dir}/rules.json`;
  writeFileSync(f, JSON.stringify([["(?<![A-Za-z])Alice's(?![A-Za-z])", "the owner's"], ["(?<![A-Za-z])Alice(?![A-Za-z])", 'the owner']]));
  const rules = loadScrubRules(f);
  assert.equal(scrub("_working with Alice_ via Alice's session; Alicent stays", rules), "_working with the owner_ via the owner's session; Alicent stays");
});
check('rules file found via FRICTION_SCRUB; a bad file is refused', () => {
  const dir = mkdtempSync(`${tmpdir()}/scrub-`);
  const f = `${dir}/r.json`;
  writeFileSync(f, '[["a"]]');
  assert.equal(scrubRulesPath({ FRICTION_SCRUB: f }), f);
  assert.throws(() => loadScrubRules(f), /string pairs/);
});
check('no rules file: only the built-in IP rule runs', () => {
  assert.equal(scrub('Alice at 10.1.2.3', loadScrubRules(null)), 'Alice at 192.0.2.3');
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
