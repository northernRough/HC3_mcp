#!/usr/bin/env node
// Unit test — get_event_history filter behaviour (regression for the
// "objectIds / from / to silently dropped" bug).
//
// Needs no live HC3: it injects a fake HC3 client that mirrors the gateway's
// real /api/events/history quirks (verified against the live HC3):
//   - from / to are honoured server-side;
//   - objectId is honoured ONLY when objectType is also present — on its own
//     it is silently ignored and the full (in-window) feed comes back;
//   - there is no server-side filter for a *set* of ids.
// The tool must therefore enforce the object-id set client-side. Run after
// `npm run compile`:
//
//   node scripts/test/unit-event-history-filters.mjs

import { system } from '../../out/mcp/tools/system.js';
import { strict as assert } from 'node:assert';

const getEventHistory = system.handlers.get_event_history;

// Fake hc3 client: records every URL and replays events from a fixture,
// applying exactly the filtering the real gateway does.
function makeFakeHc3(fixture) {
  const calls = [];
  return {
    calls,
    async request(endpoint) {
      calls.push(endpoint);
      const qs = new URLSearchParams(endpoint.split('?')[1] ?? '');
      const objectId = qs.has('objectId') ? Number(qs.get('objectId')) : undefined;
      const objectType = qs.get('objectType') ?? undefined;
      const from = qs.has('from') ? Number(qs.get('from')) : undefined;
      const to = qs.has('to') ? Number(qs.get('to')) : undefined;
      const limit = qs.has('numberOfRecords') ? Number(qs.get('numberOfRecords')) : Infinity;
      let events = fixture.filter(e =>
        (from === undefined || e.timestamp >= from) &&
        (to === undefined || e.timestamp <= to) &&
        // objectId is only effective when objectType is supplied too.
        (objectId === undefined || objectType === undefined
          || e.objects.some(o => o.id === objectId && o.type === objectType)));
      events = events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      return events;
    },
  };
}

const T = 1780099200;
const fixture = [
  { id: 1, timestamp: T + 10, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4514 }] },
  { id: 2, timestamp: T + 20, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4518 }] },
  { id: 3, timestamp: T + 30, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4519 }] },
  { id: 4, timestamp: T - 5000, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4514 }] }, // before window
  { id: 5, timestamp: T + 999999, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 4518 }] }, // after window
  { id: 6, timestamp: T + 25, type: 'DeviceActionRanEvent', objects: [{ type: 'device', id: 9999 }] }, // other device, in window
  { id: 7, timestamp: T + 40, type: 'SceneStartedEvent', objects: [{ type: 'scene', id: 297 }] }, // scene, in window
];

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// 1. The exact bug repro: object_ids + from/to and NO object_type must still
//    isolate the requested devices (the live gateway drops objectId without
//    objectType, so this only works if the tool filters client-side).
await check('object_ids + from/to (no object_type) isolates the requested devices', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, {
    object_ids: [4514, 4518, 4519],
    from: T,
    to: T + 100,
    limit: 100,
  });
  const ids = res.map(e => e.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 2, 3], `unexpected events: ${JSON.stringify(ids)}`);
});

// 2. from/to reach the request URL, and a set query is a SINGLE request that
//    pulls a generous page (no fan-out).
await check('from/to forwarded; set query is one request with a generous page', async () => {
  const hc3 = makeFakeHc3(fixture);
  await getEventHistory(hc3, { object_ids: [4514, 4518, 4519], from: T, to: T + 100, limit: 100 });
  assert.equal(hc3.calls.length, 1, `expected 1 request, got ${hc3.calls.length}`);
  const qs = new URLSearchParams(hc3.calls[0].split('?')[1]);
  assert.equal(qs.get('from'), String(T));
  assert.equal(qs.get('to'), String(T + 100));
  assert.equal(qs.get('numberOfRecords'), '1000', 'set query should pull a generous page');
  assert.equal(qs.get('objectId'), null, 'multi-id query must not pin a single objectId');
});

// 3. Single object_id + object_type lets HC3 narrow server-side, and the
//    client filter agrees.
await check('single object_id + object_type narrows server-side', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, { object_id: 4514, object_type: 'device', from: T, to: T + 100 });
  const qs = new URLSearchParams(hc3.calls[0].split('?')[1]);
  assert.equal(qs.get('objectId'), '4514');
  assert.equal(qs.get('objectType'), 'device');
  assert.deepEqual(res.map(e => e.id), [1]);
});

// 4. A scene id is matched by objects[].id like any other object.
await check('scene id filters correctly', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, { object_ids: [297], from: T, to: T + 100 });
  assert.deepEqual(res.map(e => e.id), [7]);
});

// 5. Results are newest-first.
await check('results are newest-first', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, { object_ids: [4514, 4518, 4519], from: T, to: T + 100 });
  const ts = res.map(e => e.timestamp);
  assert.deepEqual(ts, [...ts].sort((a, b) => b - a), 'not sorted newest-first');
});

// 6. since_timestamp still works as a lower-bound alias for from.
await check('since_timestamp alias still bounds the lower edge', async () => {
  const hc3 = makeFakeHc3(fixture);
  const res = await getEventHistory(hc3, { object_ids: [4514], since_timestamp: T });
  assert.ok(hc3.calls[0].includes(`from=${T}`), 'since_timestamp should forward as from');
  assert.deepEqual(res.map(e => e.id).sort((a, b) => a - b), [1]); // id 4 is before T
});

// 7. No filters → one plain request sized to the limit, no from/objectId.
await check('no filters issues one unfiltered request sized to limit', async () => {
  const hc3 = makeFakeHc3(fixture);
  await getEventHistory(hc3, { limit: 30 });
  assert.equal(hc3.calls.length, 1);
  const qs = new URLSearchParams(hc3.calls[0].split('?')[1]);
  assert.equal(qs.get('numberOfRecords'), '30');
  assert.equal(qs.get('objectId'), null);
  assert.equal(qs.get('from'), null);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll event-history filter checks passed');
process.exit(failures ? 1 : 0);
