#!/usr/bin/env node
// Unit test — friction telemetry.
//
// Two properties matter more than the feature itself:
//   1. it must NEVER break a tool call, whatever the disk does;
//   2. it must not write secrets to disk, because a local log still leaks
//      when someone pastes it into a bug report.
//
//   node scripts/test/unit-friction.mjs

import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'friction-'));
process.env.MCP_FRICTION_LOG = join(dir, 'friction.jsonl');
// `npm test` disables telemetry for the whole run so no test can append to a
// real friction log. This one test is about the telemetry itself, so it opts
// back in — and does so unconditionally, which also makes it hermetic when
// run by hand in a shell that happens to have the variable set.
delete process.env.MCP_FRICTION_DISABLE;

const F = await import('../../out/mcp/friction.js');
F._resetFrictionPath();

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

check('resolves the configured path', () => {
  assert.equal(F.frictionPath(), process.env.MCP_FRICTION_LOG);
});

check('records a failure', () => {
  F.recordFailure('upload_icon', 'HTTP 400 MISSING_PARAMETER — deviceTemplate');
  const e = F.readEntries();
  assert.equal(e.length, 1);
  assert.equal(e[0].tool, 'upload_icon');
  assert.equal(e[0].kind, 'failure');
});

check('SECURITY: credentials never reach the file', () => {
  F.recordFailure('x', 'Authorization: Basic YWRtaW46c3VwM3JzM2NyZXQ= failed');
  F.recordFailure('x', 'login failed: password="hunter2" for admin');
  F.recordFailure('x', 'token=abc123def456 rejected');
  F.recordFailure('x', 'contact nick@example.com about this');
  const raw = readFileSync(process.env.MCP_FRICTION_LOG, 'utf8');
  for (const secret of ['YWRtaW46c3VwM3JzM2NyZXQ', 'hunter2', 'abc123def456', 'nick@example.com']) {
    assert.ok(!raw.includes(secret), `secret leaked to disk: ${secret}`);
  }
  assert.ok(raw.includes('[redacted]'), 'nothing was redacted at all');
});

check('groups the same fault about different ids together', () => {
  F.recordFailure('get_icon', "could not fetch 'User1010' (device, .png)");
  F.recordFailure('get_icon', "could not fetch 'User1013' (device, .png)");
  F.recordFailure('get_icon', "could not fetch 'User1017' (device, .png)");
  const g = F.groupFailures(F.readEntries()).find(x => x.tool === 'get_icon');
  assert.equal(g.count, 3, 'ids should not split the group');
});

check('different faults on one tool stay separate', () => {
  F.recordFailure('get_icon', 'a completely different problem occurred');
  const groups = F.groupFailures(F.readEntries()).filter(x => x.tool === 'get_icon');
  assert.equal(groups.length, 2);
});

check('a finding round-trips with its reproduction', () => {
  F.recordFinding('modify_device', {
    expected: 'the view renders', actual: 'blank tile',
    reproduction: 'one device, external PUT, add selectionType as the only change',
    impact: 'a day',
  });
  const f = F.readEntries().find(e => e.kind === 'finding');
  assert.equal(f.tool, 'modify_device');
  assert.match(f.finding.reproduction, /only change/);
  assert.equal(f.finding.impact, 'a day');
});

check('NEVER throws when the path is unwritable', () => {
  const bad = join(dir, 'nope');
  mkdirSync(bad, { recursive: true });
  chmodSync(bad, 0o500);                       // read+execute, no write
  process.env.MCP_FRICTION_LOG = join(bad, 'x.jsonl');
  F._resetFrictionPath();
  // Must not throw, and must not fall back to a path the operator did not
  // name. This assertion is the one that was missing: without it the resolver
  // fell through to ~/.hc3-mcp/friction.jsonl and every test run polluted a
  // real telemetry log with fixture entries, which then showed up in triage.
  assert.equal(F.frictionPath(), null);
  F.recordFailure('t', 'should be swallowed');
  F.recordFinding('t', { expected: 'a', actual: 'b', reproduction: 'c' });
  assert.deepEqual(F.readEntries(), []);
  chmodSync(bad, 0o700);
});

check('disable flag turns it off entirely', () => {
  process.env.MCP_FRICTION_LOG = join(dir, 'off.jsonl');
  process.env.MCP_FRICTION_DISABLE = 'true';
  F._resetFrictionPath();
  assert.equal(F.frictionPath(), null);
  F.recordFailure('t', 'nothing should be written');
  assert.ok(!existsSync(join(dir, 'off.jsonl')));
  assert.deepEqual(F.readEntries(), []);
  delete process.env.MCP_FRICTION_DISABLE;
});

check('signature normalises ids, numbers and quoted values', () => {
  assert.equal(F.signature("no icon 'User1010' at 128x128"), F.signature("no icon 'User1099' at 128x128"));
  assert.notEqual(F.signature('problem A'), F.signature('problem B'));
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll friction checks passed');
process.exit(failures ? 1 : 0);
