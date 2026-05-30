#!/usr/bin/env node
// Unit test — get_event_history filter forwarding (regression for the
// "objectIds / from / to silently dropped" bug).
//
// Unlike the phase0-6 harnesses this needs no live HC3: it injects a fake
// HC3 client that records the request URLs and returns canned events, then
// asserts that from / to / object_id / object_ids actually reach the
// /api/events/history query string and that the fan-out + time window
// behave. Run after `npm run compile`:
//
//   node scripts/test/unit-event-history-filters.mjs

import { system } from '../../out/mcp/tools/system.js';
import { strict as assert } from 'node:assert';

const getEventHistory = system.handlers.get_event_history;

// A fake hc3 client: records every URL it is asked for and replays events
// from a fixture table keyed by objectId (mirroring HC3's server-side
// objectId + from/to filtering).
function makeFakeHc3(fixture) {
  const calls = [];
  return {
    calls,
    async request(endpoint) {
      calls.push(endpoint);
      const qs = new URLSearchParams(endpoint.split('?')[1] ?? '');
      const objectId = qs.has('objectId') ? Number(qs.get('objectId')) : undefined;
      const from = qs.has('from') ? Number(qs.get('from')) : undefined;
      const to = qs.has('to') ? Number(qs.get('to')) : undefined;
      const limit = qs.has('numberOfRecords') ? Number(qs.get('numberOfRecords')) : Infinity;
      let events = fixture.filter(e =>
        (objectId === undefined || e.objects.some(o => o.id === objectId)) &&
        (from === undefined || e.timestamp >= from) &&
        (to === undefined || e.timestamp <= to));
      events = events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      return events;
    },
  };
}

const T = 1780099200;
// Six in-window events across three zones plus noise outside the window /
// for other devices.
const fixture = [
  { id: 1, timestamp: T + 10, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4514 }] },
  { id: 2, timestamp: T + 20, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4518 }] },
  { id: 3, timestamp: T + 30, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4519 }] },
  { id: 4, timestamp: T - 5000, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4514 }] }, // before window
  { id: 5, timestamp: T + 999999, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4518 }] }, // after window
  { id: 6, timestamp: T + 25, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 9999 }] }, // other device, in window
  // An event referencing two requested zones — must dedupe to one row.
  { id: 7, timestamp: T + 40, type: 'SceneStartedEvent', objects: [{ type: 'device', id: 4514 }, { type: 'device', id: 4519 }] },
];

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// 1. The bug repro: from/to + objectIds must isolate exactly the in-window
//    events for the requested zones (and nothing else).
await check('from/to + object_ids isolates the requested window and devices', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, {
    object_ids: [4514, 4518, 4519],
    from: T,
    to: T + 100,
    limit: 100,
  });
  const ids = res.map(e => e.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 2, 3, 7], `unexpected events: ${JSON.stringify(ids)}`);
});

// 2. The params must actually be forwarded onto the HC3 URL (this is the
//    core of the bug — they were dropped). One request per id, each carrying
//    from + to + its objectId.
await check('from/to/objectId are forwarded onto each /api/events/history call', async () => {
  const hc3 = makeFakeHc3(fixture);
  await getEventHistory(hc3, { object_ids: [4514, 4518, 4519], from: T, to: T + 100, limit: 100 });
  assert.equal(hc3.calls.length, 3, `expected 3 fan-out calls, got ${hc3.calls.length}`);
  for (const url of hc3.calls) {
    assert.ok(url.includes(`from=${T}`), `missing from in ${url}`);
    assert.ok(url.includes(`to=${T + 100}`), `missing to in ${url}`);
    assert.ok(/objectId=\d+/.test(url), `missing objectId in ${url}`);
  }
});

// 3. Single device uses one server-side objectId call (no fan-out).
await check('single object_id forwards objectId server-side without fan-out', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, { object_id: 4514, from: T, to: T + 100 });
  assert.equal(hc3.calls.length, 1, 'expected a single request');
  assert.ok(hc3.calls[0].includes('objectId=4514'));
  assert.deepEqual(res.map(e => e.id).sort((a, b) => a - b), [1, 7]);
});

// 4. Newest-first ordering is preserved across the merged fan-out.
await check('merged results are newest-first', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, { object_ids: [4514, 4518, 4519], from: T, to: T + 100 });
  const ts = res.map(e => e.timestamp);
  assert.deepEqual(ts, [...ts].sort((a, b) => b - a), 'not sorted newest-first');
});

// 5. since_timestamp still works as a lower-bound alias for from.
await check('since_timestamp alias still bounds the lower edge', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, { object_id: 4514, since_timestamp: T });
  assert.ok(hc3.calls[0].includes(`from=${T}`), 'since_timestamp should forward as from');
  assert.deepEqual(res.map(e => e.id).sort((a, b) => a - b), [1, 7]);
});

// 6. No filters → single plain request, behaves like before.
await check('no filters issues one unfiltered request', async () => {
  const hc3 = makeFakeHc3(fixture);
  await getEventHistory(hc3, {});
  assert.equal(hc3.calls.length, 1);
  assert.ok(!hc3.calls[0].includes('objectId='));
  assert.ok(!hc3.calls[0].includes('from='));
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll event-history filter checks passed');
process.exit(failures ? 1 : 0);
