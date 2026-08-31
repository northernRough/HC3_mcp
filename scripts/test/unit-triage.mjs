#!/usr/bin/env node
// Unit test — friction triage regeneration.
//
// The property under test is not the formatting, it is that a triage run
// cannot silently destroy another machine's recorded friction. The telemetry
// log is per-machine, the hand-written ledger is carried across regardless, so
// a wrong-machine run changes only the generated half and leaves no clue that
// signal was lost.
//
//   node scripts/test/unit-triage.mjs

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = resolve(ROOT, 'scripts/friction-triage.mjs');
const dir = mkdtempSync(join(tmpdir(), 'triage-'));

const LEDGER = [
  '<!-- BEGIN manual ledger -->',
  '',
  '## Claim ledger',
  '',
  '| **refuted** | a claim that must survive regeneration | evidence |',
  '',
  '<!-- END manual ledger -->',
].join('\n');

const logPath = join(dir, 'friction.jsonl');
writeFileSync(logPath, '');

/** Run triage against `outFile`, recording to `log`. */
const run = (outFile, log, ...extra) => spawnSync(process.execPath, [SCRIPT, outFile, ...extra], {
  encoding: 'utf8',
  // MCP_FRICTION_DISABLE is set for the whole `npm test` run; this test is
  // about where triage reads from, so it opts back in.
  env: { ...process.env, MCP_FRICTION_DISABLE: '', MCP_FRICTION_LOG: log },
});

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

check('writes a fresh file when none exists', () => {
  const out = join(dir, 'fresh.md');
  const r = run(out, logPath);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(out, 'utf8'), new RegExp(`entries at \`${logPath}\``));
});

check('regenerates when the source log is the same one', () => {
  const out = join(dir, 'same.md');
  assert.equal(run(out, logPath).status, 0);
  const r = run(out, logPath);
  assert.equal(r.status, 0, r.stderr);
});

check('REFUSES when the file came from a different log', () => {
  const out = join(dir, 'other.md');
  const other = join(dir, 'elsewhere.jsonl');
  writeFileSync(other, '');
  run(out, other);                                  // generated on "machine A"
  const before = readFileSync(out, 'utf8');

  const r = run(out, logPath);                      // now run on "machine B"
  assert.equal(r.status, 1, 'expected a non-zero exit');
  assert.equal(readFileSync(out, 'utf8'), before, 'the file was modified anyway');
});

check('the refusal names both logs and the escape hatch', () => {
  const out = join(dir, 'named.md');
  const other = join(dir, 'elsewhere.jsonl');
  run(out, other);
  const r = run(out, logPath);
  assert.match(r.stderr, new RegExp(other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(r.stderr, new RegExp(logPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(r.stderr, /--force/);
});

check('--force overwrites deliberately', () => {
  const out = join(dir, 'forced.md');
  const other = join(dir, 'elsewhere.jsonl');
  run(out, other);
  const r = run(out, logPath, '--force');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(out, 'utf8'), new RegExp(`entries at \`${logPath}\``));
});

check('the hand-written ledger survives regeneration', () => {
  const out = join(dir, 'ledger.md');
  run(out, logPath);
  // Edit the ledger in place, the way a person would: the placeholder block a
  // fresh file ships with is replaced, not appended to.
  const seeded = readFileSync(out, 'utf8')
    .replace(/<!-- BEGIN manual ledger -->[\s\S]*<!-- END manual ledger -->/, LEDGER);
  writeFileSync(out, seeded);
  assert.equal(run(out, logPath).status, 0);
  const after = readFileSync(out, 'utf8');
  assert.match(after, /a claim that must survive regeneration/);
  assert.equal(after.match(/BEGIN manual ledger/g).length, 1, 'the ledger was duplicated');
});

// FRICTION.md is committed and ships in the package, so the header must not
// publish the username and home layout of whoever generated it. HOME is
// overridden for the spawned process, so this exercises the real collapse
// without writing anything into a real home directory.
const runAsHome = (outFile, log, home, ...extra) => spawnSync(process.execPath, [SCRIPT, outFile, ...extra], {
  encoding: 'utf8',
  env: { ...process.env, MCP_FRICTION_DISABLE: '', MCP_FRICTION_LOG: log, HOME: home },
});

check('the header records ~ instead of the operator home path', () => {
  const out = join(dir, 'tilde.md');
  const r = runAsHome(out, logPath, dir);
  assert.equal(r.status, 0, r.stderr);

  const text = readFileSync(out, 'utf8');
  assert.match(text, /entries at `~\/friction\.jsonl`/, 'the home prefix was not collapsed');
  assert.ok(!text.includes(dir), 'the absolute home path is still in the file');
});

check('a path outside the home directory is left alone', () => {
  // Only the home prefix is cosmetic. /var/lib/hc3-mcp on a deployed unit is
  // real, shared information and must keep saying what it says.
  const out = join(dir, 'outside.md');
  const other = join(dir, 'elsewhere.jsonl');
  writeFileSync(other, '');

  const r = runAsHome(out, other, join(dir, 'nowhere-near'));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(out, 'utf8').includes('entries at `' + other + '`'));
});

check('an existing absolute-home header regenerates without --force', () => {
  // The transition case. Collapsing only the written form would make every
  // later run compare ~/... against a stored /Users/... and demand --force for
  // a purely cosmetic difference -- which trains people to pass --force by
  // reflex, and that flag is the only thing stopping one machine's telemetry
  // from silently replacing another's.
  const out = join(dir, 'transition.md');
  writeFileSync(out, [
    '# Friction triage\n',
    '_Generated 2026-01-01 00:00 UTC from 1 entries at `' + logPath + '`._\n',
    LEDGER,
  ].join('\n'));

  const r = runAsHome(out, logPath, dir);
  assert.equal(r.status, 0, 'expected no --force to be needed:\n' + r.stderr);
  assert.match(readFileSync(out, 'utf8'), /entries at `~\/friction\.jsonl`/);
});

check('the different-log refusal still fires once paths are collapsed', () => {
  // The collapse must not accidentally make two different logs compare equal,
  // which would defeat the guard this whole file exists to protect.
  const out = join(dir, 'still-refuses.md');
  const other = join(dir, 'other-machine.jsonl');
  writeFileSync(other, '');

  runAsHome(out, other, dir);                       // generated on "machine A"
  const before = readFileSync(out, 'utf8');

  const r = runAsHome(out, logPath, dir);           // now "machine B"
  assert.equal(r.status, 1, 'expected a non-zero exit');
  assert.equal(readFileSync(out, 'utf8'), before, 'the file was modified anyway');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll triage checks passed');
process.exit(failures ? 1 : 0);
