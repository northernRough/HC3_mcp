#!/usr/bin/env node
// Unit test — 4.42.0, battery wake-up interval through HC3's Z-Wave engine
// (live test 15 Nov 2026 on an FGMS001 motion sensor). Fake clients only.
//
//   node scripts/test/unit-wakeup.mjs

import { strict as assert } from 'node:assert';
const { zwave } = await import('../../out/mcp/tools/zwave.js');
const { devices } = await import('../../out/mcp/tools/devices.js');
const { plugins } = await import('../../out/mcp/tools/plugins.js');
const { HC3HttpError } = await import('../../out/mcp/hc3-client.js');
const Z = zwave.handlers;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`); }
}

/**
 * A sleeping battery node 42 as observed: the device record holds a stale
 * wakeUpTime, the Z-Wave engine holds the real interval, a PUT queues a
 * setConfiguration in the mailbox, and a wake (s.wake()) delivers it.
 */
function batteryNode({ interval = 43200, record = 43200, pending = [], wakeAfterCalls = Infinity, remote = false } = {}) {
  const calls = [];
  const s = { interval, record, pending: [...pending], nextId: 9, mailboxCalls: 0 };
  s.wake = () => {
    const q = s.pending.filter(p => p.type === 'setConfiguration');
    if (q.length) s.interval = q[q.length - 1].interval;
    s.pending = [];
  };
  return { calls, s, async request(ep, method = 'GET', body) {
    calls.push({ ep, method, body });
    if (ep === '/api/devices/601' || ep === '/api/devices/602') {
      return { id: Number(ep.split('/').pop()), name: 'motion sensor', interfaces: remote ? ['zwave', 'remoteDevice'] : ['zwave', 'zwaveWakeup'],
               properties: { nodeId: 42, wakeUpTime: s.record } };
    }
    if (ep === '/api/devices/4817') return { id: 4817, name: 'mains dimmer', interfaces: ['zwave'], properties: { nodeId: 187 } };
    if (ep === '/api/devices/77') return { id: 77, name: 'a QuickApp', properties: {} };
    if (ep === '/api/zwave/wake_ups/187') throw new HC3HttpError(404, 'Not Found', method, ep, '');
    if (ep === '/api/zwave/wake_ups/42') {
      return { addr: 42, lastTime: '2026-11-15T14:07:52+00:00', expectedNextTime: '2026-11-16T02:07:52+00:00',
               configuration: { interval: s.interval, destination: 1 }, intervalDefinition: { min: 1, max: 65535, default: 7200 } };
    }
    if (ep === '/api/zwave/mailbox/42/wake_ups') {
      if (++s.mailboxCalls >= wakeAfterCalls) s.wake();
      return { items: s.pending };
    }
    if (ep === '/api/zwave/mailbox/42/wake_ups/clear' && method === 'POST') { s.pending = []; return null; }
    if (ep === '/api/zwave/wake_ups/42/configuration' && method === 'PUT') {
      const id = s.nextId++;
      s.pending.push({ actionId: id, type: 'setConfiguration', interval: body.interval, destination: body.destination });
      return { actionId: id };
    }
    throw new Error(`unexpected ${method} ${ep}`);
  } };
}
const puts = c => c.calls.filter(x => x.method === 'PUT');

console.log('get_wake_up');
await check('reads the engine, not the record, and flags a disagreeing record', async () => {
  const r = await Z.get_wake_up(batteryNode({ interval: 300, record: 43200 }), { deviceId: 602 });
  assert.equal(r.interval, 300);
  assert.equal(r.nodeId, 42);
  assert.equal(r.deviceRecordWakeUpTime, 43200);
  assert.equal(r.deviceRecordAgrees, false);
  assert.match(r.note, /stale copy/);
  assert.equal(r.expectedNextWake, '2026-11-16T02:07:52+00:00');
  assert.deepEqual(r.allowed, { min: 1, max: 65535, default: 7200 });
});
await check('shows a queued interval', async () => {
  const r = await Z.get_wake_up(batteryNode({ pending: [{ actionId: 8, type: 'setConfiguration', interval: 600, destination: 1 }] }), { deviceId: 601 });
  assert.equal(r.queuedInterval, 600);
  assert.equal(r.pending.length, 1);
});
await check('a mains node is refused with a reason', async () => {
  await assert.rejects(Z.get_wake_up(batteryNode(), { deviceId: 4817 }), /not a sleeping battery node/);
});
await check('a non-Z-Wave device is refused', async () => {
  await assert.rejects(Z.get_wake_up(batteryNode(), { deviceId: 77 }), /no Z-Wave nodeId/);
});
await check('a remote-gateway device is refused', async () => {
  await assert.rejects(Z.get_wake_up(batteryNode({ remote: true }), { deviceId: 601 }), /remote/);
});

console.log('set_wake_up_interval');
await check('queues through the engine with the existing destination', async () => {
  const c = batteryNode();
  const r = await Z.set_wake_up_interval(c, { deviceId: 601, interval: 21600 });
  assert.equal(puts(c).length, 1);
  assert.deepEqual(puts(c)[0].body, { destination: 1, interval: 21600 });
  assert.equal(r.queued, true);
  assert.equal(r.delivered, false);
  assert.equal(r.interval, 43200, 'the node keeps its old interval until it wakes');
  assert.match(r.outcome, /Queued/);
});
await check('outside the node\'s allowed range: refused, nothing sent', async () => {
  const c = batteryNode();
  await assert.rejects(Z.set_wake_up_interval(c, { deviceId: 601, interval: 70000 }), /outside node 42's allowed range 1-65535/);
  assert.equal(puts(c).length, 0);
});
await check('a short interval needs allowShortInterval', async () => {
  const c = batteryNode();
  await assert.rejects(Z.set_wake_up_interval(c, { deviceId: 601, interval: 300 }), /drain its battery/);
  assert.equal(puts(c).length, 0);
  const r = await Z.set_wake_up_interval(c, { deviceId: 601, interval: 300, allowShortInterval: true });
  assert.equal(r.queued, true);
  assert.match(r.batteryWarning, /Restore/);
});
await check('the value already set, nothing queued: no-op', async () => {
  const c = batteryNode({ interval: 43200 });
  const r = await Z.set_wake_up_interval(c, { deviceId: 601, interval: 43200 });
  assert.equal(r.changed, false);
  assert.equal(puts(c).length, 0);
});
await check('the same value already queued: no-op', async () => {
  const c = batteryNode({ pending: [{ actionId: 8, type: 'setConfiguration', interval: 21600, destination: 1 }] });
  const r = await Z.set_wake_up_interval(c, { deviceId: 601, interval: 21600 });
  assert.equal(r.changed, false);
  assert.equal(puts(c).length, 0);
});
await check('a different value queued: refused unless replacePending, which clears first', async () => {
  const c = batteryNode({ pending: [{ actionId: 8, type: 'setConfiguration', interval: 600, destination: 1 }] });
  await assert.rejects(Z.set_wake_up_interval(c, { deviceId: 601, interval: 21600 }), /600 s is already queued/);
  assert.equal(puts(c).length, 0);
  const r = await Z.set_wake_up_interval(c, { deviceId: 601, interval: 21600, replacePending: true });
  const order = c.calls.filter(x => x.method !== 'GET').map(x => x.method);
  assert.deepEqual(order, ['POST', 'PUT'], 'clear before queue');
  assert.equal(r.clearedPending[0].interval, 600);
  assert.equal(r.queuedInterval, 21600);
  assert.equal(c.s.pending.length, 1);
});
await check('waitSeconds reports delivery when the node wakes', async () => {
  const c = batteryNode({ wakeAfterCalls: 3 });
  const r = await Z.set_wake_up_interval(c, { deviceId: 601, interval: 21600, waitSeconds: 30 });
  assert.equal(r.delivered, true);
  assert.equal(r.interval, 21600);
  assert.match(r.outcome, /Delivered/);
});
await check('bad arguments refused before any request', async () => {
  const c = batteryNode();
  await assert.rejects(Z.set_wake_up_interval(c, { deviceId: 601, interval: 12.5 }), /integer/);
  await assert.rejects(Z.set_wake_up_interval(c, { deviceId: 601, interval: 21600, waitSeconds: 900 }), /waitSeconds/);
  assert.equal(c.calls.length, 0);
});

console.log('stale-record write paths');
await check('update_device_property refuses wakeUpTime', async () => {
  const c = batteryNode();
  await assert.rejects(plugins.handlers.update_device_property(c, { deviceId: 601, propertyName: 'wakeUpTime', value: 600 }), /set_wake_up_interval/);
  assert.equal(c.calls.length, 0);
});
await check('modify_device refuses properties.wakeUpTime', async () => {
  const c = batteryNode();
  await assert.rejects(devices.handlers.modify_device(c, { deviceId: 601, properties: { wakeUpTime: 600 } }), /set_wake_up_interval/);
  assert.equal(c.calls.filter(x => x.method === 'PUT').length, 0);
});

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall ok');
