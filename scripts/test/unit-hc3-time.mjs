#!/usr/bin/env node
// Unit test — get_hc3_time. No live HC3: injects a fake client returning a
// canned /api/settings/info payload and asserts the derived fields, the
// weekday (the whole point of the tool), the skew guard, and that
// serverStatus is never consulted.
//
//   node scripts/test/unit-hc3-time.mjs

import { system } from '../../out/mcp/tools/system.js';
import { strict as assert } from 'node:assert';

const getHc3Time = system.handlers.get_hc3_time;

function fakeHc3(info) {
  return { async request(endpoint) {
    assert.equal(endpoint, '/api/settings/info', `unexpected endpoint ${endpoint}`);
    return info;
  } };
}

// Sample from the spec (firmware 5.210.12). timestamp 1784623728 = 2026-07-21
// 08:48:48Z; with offset 3600 → 09:48:48 local, a Tuesday.
const SAMPLE = {
  date: '09:48 | 21.7.2026',
  dateFormat: 'dd.mm.yy',
  timeFormat: 24,
  timezoneOffset: 3600,
  serverStatus: 1783325359, // stale heartbeat — must be ignored
  timestamp: 1784623728,
  sunriseHour: '05:12',
  sunsetHour: '21:05',
};

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

await check('derives epoch / iso_utc / iso_local from timestamp + offset', async () => {
  const r = await getHc3Time(fakeHc3(SAMPLE));
  assert.equal(r.epoch, 1784623728);
  assert.equal(r.iso_utc, '2026-07-21T08:48:48Z');
  assert.equal(r.iso_local, '2026-07-21T09:48:48+01:00');
  assert.equal(r.timezone_offset_s, 3600);
});

await check('weekday is correct and matches the front of local_pretty', async () => {
  const r = await getHc3Time(fakeHc3(SAMPLE));
  assert.equal(r.weekday, 'Tuesday');
  assert.equal(r.weekday_short, 'Tue');
  assert.equal(r.local_pretty, 'Tuesday 21 Jul 2026 09:48 BST');
  assert.ok(r.local_pretty.startsWith(r.weekday), 'local_pretty must lead with the returned weekday');
});

// Spec acceptance spot-check: 25 July 2026 is a Saturday.
await check('spot-check: 25 Jul 2026 is Saturday', async () => {
  // 2026-07-25T12:00:00Z, offset 0 → still the 25th locally.
  const r = await getHc3Time(fakeHc3({ ...SAMPLE, timestamp: 1784980800, timezoneOffset: 0 }));
  assert.equal(r.iso_utc, '2026-07-25T12:00:00Z');
  assert.equal(r.weekday, 'Saturday');
  assert.ok(r.local_pretty.includes('25 Jul 2026'), r.local_pretty);
  assert.ok(r.local_pretty.endsWith('GMT'), r.local_pretty);
});

await check('offset applied so a UTC evening can be the next local day', async () => {
  // 2026-07-21T23:30:00Z + 3600 → 2026-07-22 00:30 local (Wednesday).
  const r = await getHc3Time(fakeHc3({ ...SAMPLE, timestamp: 1784676600 }));
  assert.equal(r.iso_utc, '2026-07-21T23:30:00Z');
  assert.equal(r.iso_local, '2026-07-22T00:30:00+01:00');
  assert.equal(r.weekday, 'Wednesday');
});

await check('skew > 120s pushes a warning but the call still succeeds', async () => {
  // timestamp far in the past relative to the host's real clock.
  const r = await getHc3Time(fakeHc3({ ...SAMPLE, timestamp: 1000000000 }));
  assert.equal(r.epoch, 1000000000);
  assert.ok(r.warnings.some(w => /differ by \d+s/.test(w)), `expected skew warning, got ${JSON.stringify(r.warnings)}`);
});

await check('fresh timestamp (host-agreeing) yields no skew warning', async () => {
  const nowIsh = Math.floor(Date.now() / 1000);
  const r = await getHc3Time(fakeHc3({ ...SAMPLE, timestamp: nowIsh }));
  assert.deepEqual(r.warnings, []);
});

await check('serverStatus is never used as now', async () => {
  // serverStatus is a plausible-looking but stale field; epoch must come from
  // timestamp, not serverStatus.
  const r = await getHc3Time(fakeHc3(SAMPLE));
  assert.notEqual(r.epoch, SAMPLE.serverStatus);
  assert.equal(r.epoch, SAMPLE.timestamp);
  assert.equal(r.source, 'hc3:/api/settings/info:timestamp');
});

await check('missing timestamp throws (no silent wrong answer)', async () => {
  await assert.rejects(() => getHc3Time(fakeHc3({ ...SAMPLE, timestamp: undefined })), /timestamp/);
});

await check('missing timezoneOffset assumes UTC and warns', async () => {
  const r = await getHc3Time(fakeHc3({ ...SAMPLE, timezoneOffset: undefined }));
  assert.equal(r.timezone_offset_s, 0);
  assert.ok(r.warnings.some(w => /timezoneOffset/.test(w)));
});

await check('date_field_raw is returned verbatim for eyeballing', async () => {
  const r = await getHc3Time(fakeHc3(SAMPLE));
  assert.equal(r.date_field_raw, '09:48 | 21.7.2026');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll get_hc3_time checks passed');
process.exit(failures ? 1 : 0);
