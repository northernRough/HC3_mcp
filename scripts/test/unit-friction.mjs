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

// The disable-flag check above leaves the resolver CACHED as null, so anything
// appended after it silently goes nowhere. Re-point telemetry at a fresh log
// and prove it is live before the classification checks run -- otherwise "the
// entry count did not change" passes for the wrong reason, and a test that
// passes because nothing happened is worse than one that fails.
process.env.MCP_FRICTION_LOG = join(dir, 'classify.jsonl');
delete process.env.MCP_FRICTION_DISABLE;
F._resetFrictionPath();

check('telemetry is live for the classification checks', () => {
  assert.notEqual(F.frictionPath(), null, 'these checks would pass vacuously');
});

check('a configuration error is NOT recorded at all', () => {
  // The one failure class that arrives in bulk: a missing environment does not
  // fail one call, it fails every call. 159 such entries -- 60% of this
  // project's own log -- came from two seconds on 2026-08-15, and outranked
  // every real fault in a table that sorts by count.
  //
  // A real failure is recorded first, so this cannot pass by the log being
  // dead: the count must MOVE for one and hold for the other.
  const before = F.readEntries().length;
  F.recordFailure('get_devices', 'HTTP 404: Not Found');
  assert.equal(F.readEntries().length, before + 1, 'the log is not accepting entries');

  F.recordFailure('get_devices', 'Fibaro HC3 not configured. Please check environment variables.');
  F.recordFailure('upload_icon', 'Fibaro HC3 not configured.');
  assert.equal(F.readEntries().length, before + 1, 'configuration errors reached the log');
});

check('a routing error IS still recorded', () => {
  // Deliberately not lumped in with configuration, despite sharing the
  // finding-nudge exemption. A run of these is the documented stale-schema
  // symptom after a redeploy, which is precisely what the log should show.
  const before = F.readEntries().length;
  F.recordFailure('does_not_exist', 'Unknown tool: does_not_exist');
  const after = F.readEntries();
  assert.equal(after.length, before + 1, 'a routing error was dropped');
  assert.equal(after[after.length - 1].tool, 'does_not_exist');
});

check('an error that merely MENTIONS configuration is still recorded', () => {
  // The predicate is anchored on purpose. Widening it to anything mentioning
  // configuration or environment variables would swallow gateway errors that
  // happen to use those words -- dropping a real failure costs the evidence,
  // while keeping a boring one costs a line.
  const before = F.readEntries().length;
  F.recordFailure('set_device_parameter', 'HTTP 500: the device rejected the configuration parameter write');
  F.recordFailure('get_home_status', 'Fibaro HC3 is configured but unreachable at the configured host');
  assert.equal(F.readEntries().length, before + 2, 'an anchored-only skip swallowed a real failure');
});

check('isConfigurationError and invitesAFinding agree on the class', () => {
  // One definition, used by both, so the recorded set and the nudged set
  // cannot drift apart.
  assert.equal(F.isConfigurationError('Fibaro HC3 not configured. Please check environment variables.'), true);
  assert.equal(F.isConfigurationError('Fibaro HC3 not configured.'), true);
  assert.equal(F.isConfigurationError('Unknown tool: nope'), false);
  assert.equal(F.isConfigurationError('HTTP 404: Not Found'), false);
  assert.equal(F.isConfigurationError(undefined), false);

  assert.equal(F.invitesAFinding('get_devices', 'Fibaro HC3 not configured.'), false);
  assert.equal(F.invitesAFinding('x', 'Unknown tool: x'), false);
  assert.equal(F.invitesAFinding('get_device_info', 'HTTP 404: Not Found'), true);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll friction checks passed');
process.exit(failures ? 1 : 0);
