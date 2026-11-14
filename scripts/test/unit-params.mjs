#!/usr/bin/env node
// Unit test — 4.39.0, Z-Wave parameter read-back (live test 14 Nov 2026 on an
// FGRGBW442, node 187). Fake clients only.
//
//   node scripts/test/unit-params.mjs

import { strict as assert } from 'node:assert';
const { zwave } = await import('../../out/mcp/tools/zwave.js');
const { HC3HttpError } = await import('../../out/mcp/hc3-client.js');
const Z = zwave.handlers;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`); }
}

/**
 * A model of node 187: parameters only at the root address, a device that
 * accepts values in [30, 32400] and refuses others, HC3 refreshing its cache
 * from the device after a write or poll, and radio counters that move only
 * when something is sent.
 */
function node187({ deviceValue = 3600, cacheValue = deviceValue, deaf = false, noCounters = false } = {}) {
  const calls = [];
  const s = { device: deviceValue, cache: cacheValue, in: 579, out: 425 };
  const exchange = (out, back) => { if (deaf) return; s.out += out; s.in += back; s.cache = s.device; };
  return { calls, s, async request(ep, method = 'GET', body) {
    calls.push({ ep, method, body });
    if (ep === '/api/devices/4817') return { id: 4817, name: '12V colours & rails', properties: { nodeId: '187', endPointId: '1' } };
    if (ep === '/api/zwave/configuration_parameters/187.0') return { items: [{ parameterNumber: 66, configurationValue: s.cache, size: 2, source: { type: 'template' } }] };
    if (ep === '/api/zwave/parameters_templates/187.0') return { parameters: [{ parameterNumber: 66, label: { en: 'Energy reports - periodic' }, defaultValue: 3600 }] };
    if (ep.startsWith('/api/zwave/configuration_parameters/') || ep.startsWith('/api/zwave/parameters_templates/')) throw new HC3HttpError(404, 'Not Found', method, ep, '');
    if (ep === '/api/zwave/nodes/diagnostics/transmissions') {
      if (noCounters) throw new HC3HttpError(501, 'Not Implemented', method, ep, '');
      return { items: [{ nodeId: 12, incomingTotal: 1, outgoingTotal: 1, outgoingFailed: 0 }, { nodeId: 187, incomingTotal: s.in, outgoingTotal: s.out, outgoingFailed: 0 }] };
    }
    if (ep === '/api/devices/4817/action/setConfiguration' && method === 'POST') {
      const v = body.args[2];
      if (!deaf && v >= 30 && v <= 32400) s.device = v;
      exchange(2, 1);
      return { result: null };
    }
    if (ep.startsWith('/api/zwave/polling/configuration_parameters/187.0/') && method === 'POST') { exchange(1, 1); return null; }
    throw new Error(`unexpected ${method} ${ep}`);
  } };
}

console.log('address');
await check('an endpoint child reads its parameters at the root {nodeId}.0', async () => {
  const r = await Z.get_device_parameters(node187(), { deviceId: 4817 });
  assert.equal(r.addr, '187.0');
  assert.equal(r.parameters[0].value, 3600);
  assert.equal(r.parameters[0].label, 'Energy reports - periodic');
});
await check('set_device_parameter sees before and after at the root', async () => {
  const r = await Z.set_device_parameter(node187(), { deviceId: 4817, parameterNumber: 66, size: 2, value: 3000 });
  assert.equal(r.addr, '187.0');
  assert.equal(r.before.value, 3600);
  assert.equal(r.after.value, 3000);
});

console.log('set_device_parameter radio evidence');
await check('a valid write: transmitted and cache updated', async () => {
  const r = await Z.set_device_parameter(node187(), { deviceId: 4817, parameterNumber: 66, size: 2, value: 3000 });
  assert.equal(r.transmitted, true);
  assert.equal(r.cacheUpdated, true);
  assert.deepEqual(r.radio, { framesOut: 2, framesIn: 1, outgoingFailed: 0 });
  assert.match(r.outcome, /^Transmitted \(2 frame\(s\) out, 1 back\) and HC3's cache now holds 3000/);
});
await check('an out-of-range write: transmitted, refused by the device', async () => {
  const r = await Z.set_device_parameter(node187(), { deviceId: 4817, parameterNumber: 66, size: 2, value: 5 });
  assert.equal(r.transmitted, true);
  assert.equal(r.cacheUpdated, false);
  assert.match(r.outcome, /cache still holds 3600/);
  assert.match(r.outcome, /REFUSED/);
  assert.match(r.outcome, /TRIGGER parameter/);
});
await check('no frames sent: says it did not reach the device', async () => {
  const r = await Z.set_device_parameter(node187({ deaf: true }), { deviceId: 4817, parameterNumber: 66, size: 2, value: 3000 });
  assert.equal(r.transmitted, false);
  assert.match(r.outcome, /NO frames went to the node/);
});
await check('counters unavailable: transmitted is null, no claim either way', async () => {
  const r = await Z.set_device_parameter(node187({ noCounters: true }), { deviceId: 4817, parameterNumber: 66, size: 2, value: 3000 });
  assert.equal(r.transmitted, null);
  assert.equal(r.radio, null);
  assert.match(r.outcome, /radio counters unavailable/);
});

console.log('get_device_parameters refreshFromDevice');
await check('a stale cache is corrected by the poll and reported', async () => {
  const hc3 = node187({ deviceValue: 3000, cacheValue: 3600 });
  const r = await Z.get_device_parameters(hc3, { deviceId: 4817, refreshFromDevice: [66] });
  assert.deepEqual(r.refreshFromDevice.changed, [{ parameterNumber: 66, was: 3600, now: 3000 }]);
  assert.deepEqual(r.refreshFromDevice.radio, { framesOut: 1, framesIn: 1, outgoingFailed: 0 });
  assert.equal(r.parameters[0].value, 3000);
  assert.ok(hc3.calls.some(c => c.method === 'POST' && c.ep === '/api/zwave/polling/configuration_parameters/187.0/66'));
});
await check('a poll that sends nothing says the node was not reached', async () => {
  const r = await Z.get_device_parameters(node187({ deaf: true }), { deviceId: 4817, refreshFromDevice: [66] });
  assert.match(r.refreshFromDevice.note, /No frames went to the node/);
});
await check('bad refreshFromDevice is refused before anything is sent', async () => {
  const hc3 = node187();
  await assert.rejects(Z.get_device_parameters(hc3, { deviceId: 4817, refreshFromDevice: [0] }), /up to 20 parameter numbers/);
  assert.ok(!hc3.calls.some(c => c.method === 'POST'));
});
await check('refreshFromDevice sent as a JSON string or comma list is accepted', async () => {
  for (const v of ['[66]', '66', ' 66 ,']) {
    const r = await Z.get_device_parameters(node187(), { deviceId: 4817, refreshFromDevice: v });
    assert.deepEqual(Object.keys(r.refreshFromDevice.polled), ['66'], v);
  }
});
await check('without refreshFromDevice nothing is polled', async () => {
  const hc3 = node187();
  const r = await Z.get_device_parameters(hc3, { deviceId: 4817 });
  assert.ok(!('refreshFromDevice' in r));
  assert.ok(!hc3.calls.some(c => c.method === 'POST'));
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
