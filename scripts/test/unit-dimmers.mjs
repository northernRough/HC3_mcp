#!/usr/bin/env node
// Unit test — 4.40.0 dimmer calibration (calibrate_dimmer, sync_dimmer_tuner)
// and the set_device_parameter size guard. A simulated Qubino whose LED lamps
// reach full power at 55% output, as the kitchen island spots did on 14 Nov 2026.
//
//   node scripts/test/unit-dimmers.mjs

import { strict as assert } from 'node:assert';
process.env.HC3_DIMMER_SETTLE_MS = '0';
const { dimmers, profileFor } = await import('../../out/mcp/tools/dimmers.js');
const { zwave } = await import('../../out/mcp/tools/zwave.js');
const { HC3HttpError } = await import('../../out/mcp/hc3-client.js');
const H = dimmers.handlers;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`); }
}

const TEMPLATES = {
  qubino: { description: 'Qubino Mini Dimmer (ZMNHHD1)', parameters: [40, 60, 61, 71, 72].map(n => ({ parameterNumber: n, size: 1 })) },
  fgd212: { description: 'FGD212 Dimmer', parameters: [1, 2, 13, 14, 50].map(n => ({ parameterNumber: n, size: 1 })).concat([{ parameterNumber: 53, size: 2 }]) },
  zen54:  { description: 'ZEN54 Dimmer ZW800', parameters: [4, 5].map(n => ({ parameterNumber: n, size: 1 })) },
};

/**
 * One dimmer on node 72 (root 3749, light 3750), plus a Dimmer Tuner QA 5079.
 * Light output = min + (level-1)/98 * (max-min); lamp power saturates at `sat`.
 */
function rig({ model = 'qubino', params, full = 22.6, sat = 55, meters = true, lightOn = false, register, topLoss = false, glitch = {} } = {}) {
  const P = params ?? (model === 'qubino' ? { 40: 50, 60: 20, 61: 99, 71: 0, 72: 1 }
                    : model === 'fgd212' ? { 1: 12, 2: 79, 13: 0, 14: 1, 50: 10, 53: 10 } : { 4: 1, 5: 99 });
  const minP = model === 'qubino' ? 60 : model === 'fgd212' ? 1 : 4, maxP = model === 'qubino' ? 61 : model === 'fgd212' ? 2 : 5;
  const s = { level: lightOn ? 40 : 0, on: lightOn, frames: { in: 100, out: 100 } };
  let vars = [{ name: 'dimmers', type: 'string', value: JSON.stringify(register ?? [{ node: 72, lightId: 3750, rootId: 3749, name: 'island spots', room: 'Kitchen', model, min: 20, max: 99, tunedMin: 14, tunedAt: '2026-11-14 18:00' }]) }];
  const calls = [];
  const power = () => {
    if (!s.on || s.level === 0) return 0;
    // glitch: level -> readings served (once each, per read) before the true value
    if (glitch[s.level]?.length) return glitch[s.level].shift();
    // topLoss: lowering the maximum costs more output than linear, as real lamps did
    const max = topLoss ? P[maxP] * P[maxP] / 99 : P[maxP];
    const out = P[minP] + (s.level - 1) / 98 * (max - P[minP]);
    return Math.round(full * Math.min(1, out / sat) * 10) / 10;
  };
  const light = () => ({ id: 3750, name: 'island spots', type: 'com.fibaro.multilevelSwitch', parentId: 3749, roomID: 7,
    properties: { nodeId: 72, value: s.level, state: s.on, ...(meters ? { power: power() } : {}) } });
  const root = { id: 3749, name: 'kitchen island spots', type: 'com.fibaro.zwaveDevice', parentId: 1, properties: { nodeId: 72 } };
  return { calls, P, s, get vars() { return vars; }, async request(ep, method = 'GET', body) {
    calls.push({ ep, method, body });
    if (ep === '/api/devices?interface=zwave') return [root, light()];
    if (ep === '/api/rooms') return [{ id: 7, name: 'Kitchen' }];
    if (ep === '/api/devices?interface=quickApp') return [{ id: 5079, name: 'Dimmer Tuner' }];
    if (ep === '/api/devices/5079') {
      if (method === 'PUT') { vars = body.properties.quickAppVariables; return {}; }
      return { id: 5079, name: 'Dimmer Tuner', properties: { quickAppVariables: vars } };
    }
    if (ep === '/api/devices/3749') return root;
    if (ep === '/api/devices/3750') return light();
    if (ep === '/api/zwave/parameters_templates/72.0') return TEMPLATES[model];
    if (ep === '/api/zwave/configuration_parameters/72.0') return { items: Object.entries(P).map(([n, v]) => ({ parameterNumber: Number(n), configurationValue: v, size: 1 })) };
    if (ep.startsWith('/api/zwave/')) {
      if (ep.startsWith('/api/zwave/polling/')) return null;
      if (ep === '/api/zwave/nodes/diagnostics/transmissions') return { items: [{ nodeId: 72, incomingTotal: s.frames.in, outgoingTotal: s.frames.out, outgoingFailed: 0 }] };
      throw new HC3HttpError(404, 'Not Found', method, ep, '');
    }
    if (ep === '/api/devices/3749/action/setConfiguration') {
      const [n, , v] = body.args; s.frames.out += 2; s.frames.in += 1;
      if (model === 'fgd212' && n === 13 && v === 1) { P[1] = 30; P[2] = 85; P[14] = 1; return { result: null }; }   // calibration overwrites min/max
      if (model === 'qubino' && n === 71 && v === 2) { P[72] = 1; return { result: null }; }                          // trigger resets itself
      P[n] = v; return { result: null };
    }
    if (ep === '/api/devices/3750/action/setValue') { s.level = body.args[0]; s.on = s.level > 0; return null; }
    if (ep === '/api/devices/3750/action/turnOff') { s.on = false; return null; }
    throw new Error(`unexpected ${method} ${ep}`);
  } };
}

console.log('profiles');
await check('template descriptions map to profiles', () => {
  assert.equal(profileFor('Qubino Mini Dimmer (ZMNHHD1)').key, 'qubino');
  assert.equal(profileFor('FGD212 Dimmer').key, 'fgd212');
  assert.equal(profileFor('ZEN54 Dimmer ZW800').key, 'zen54');
  assert.equal(profileFor('RGBW Controller 2'), undefined);
});

console.log('calibrate_dimmer');
await check('finds the plateau, picks a maximum that keeps full power at 99%', async () => {
  const hc3 = rig();
  const r = await H.calibrate_dimmer(hc3, { deviceId: 3750 });
  assert.equal(r.fullPowerW, 22.6);
  assert.equal(r.plateauAtLevel, 50);
  assert.equal(r.chosenMax, 60);
  assert.equal(hc3.P[61], 60);
  assert.ok(r.sweepFinal.at(-1)[1] >= 0.97 * 22.6);
  assert.ok(r.writes.every(w => w.transmitted === true));
});
await check('restores the light and the power-report threshold', async () => {
  const hc3 = rig({ lightOn: true });
  const r = await H.calibrate_dimmer(hc3, { deviceId: 3749 });
  assert.equal(hc3.P[40], 50);
  assert.equal(hc3.s.level, 40);
  assert.equal(r.restored.light, 40);
  assert.equal(r.restored.reportThreshold, 50);
});
await check('a light that was off is turned off again', async () => {
  const hc3 = rig();
  await H.calibrate_dimmer(hc3, { deviceId: 3750 });
  assert.equal(hc3.s.on, false);
});
await check('raises the maximum in steps of 5 until 99% reaches full power', async () => {
  const hc3 = rig({ topLoss: true });   // the first guess (plateau + 10) falls short
  const r = await H.calibrate_dimmer(hc3, { deviceId: 3750 });
  assert.ok(r.chosenMax > r.plateauAtLevel + 10, `chosen ${r.chosenMax}, plateau ${r.plateauAtLevel}`);
  assert.equal((r.chosenMax - (r.plateauAtLevel + 10)) % 5, 0);
  assert.ok(r.sweepFinal.at(-1)[1] >= 0.97 * 22.6);
});
await check('no plateau: maximum stays at 99', async () => {
  const hc3 = rig({ sat: 120 });
  const r = await H.calibrate_dimmer(hc3, { deviceId: 3750 });
  assert.equal(r.chosenMax, 99);
  assert.match(r.summary, /no headroom/);
});
await check('updates the Dimmer Tuner register with the new maximum, keeping the tuned minimum', async () => {
  const hc3 = rig();
  const r = await H.calibrate_dimmer(hc3, { deviceId: 3750 });
  const reg = JSON.parse(hc3.vars[0].value);
  assert.equal(reg[0].max, 60);
  assert.equal(reg[0].tunedMin, 14);
  assert.equal(r.quickAppId, 5079);
});
await check('FGD212 device calibration: the overwritten minimum is put back', async () => {
  const hc3 = rig({ model: 'fgd212' });
  const r = await H.calibrate_dimmer(hc3, { deviceId: 3750, deviceCalibration: true });
  assert.equal(r.deviceCalibration.succeeded, true);
  assert.equal(r.deviceCalibration.minAfter, 30);
  assert.equal(r.deviceCalibration.minimumRestored, 12);
  assert.equal(hc3.P[1], 12);
});
await check('keepMinimum:false accepts the calibration minimum', async () => {
  const hc3 = rig({ model: 'fgd212' });
  await H.calibrate_dimmer(hc3, { deviceId: 3750, deviceCalibration: true, keepMinimum: false });
  assert.equal(hc3.P[1], 30);
});
await check('a dimmer without metering is refused unless only calibrating', async () => {
  await assert.rejects(H.calibrate_dimmer(rig({ model: 'zen54', meters: false }), { deviceId: 3750 }), /does not meter power/);
});
await check('a load drawing nothing aborts and still restores', async () => {
  const hc3 = rig({ full: 0 });
  await assert.rejects(H.calibrate_dimmer(hc3, { deviceId: 3750 }), /no measurable power/);
  assert.equal(hc3.P[40], 50);
  assert.equal(hc3.s.on, false);
});
await check('bad levels are refused before anything changes', async () => {
  const hc3 = rig();
  await assert.rejects(H.calibrate_dimmer(hc3, { deviceId: 3750, levels: [0, 50] }), /levels must be/);
  assert.ok(!hc3.calls.some(c => c.method === 'POST'));
});

await check('a reading that falls as the level rises is re-measured, then the run continues', async () => {
  // Two stale reads (measure reads until two agree) at level 60, then the truth.
  const hc3 = rig({ glitch: { 60: [5, 5] } });
  const r = await H.calibrate_dimmer(hc3, { deviceId: 3750 });
  assert.equal(r.reliable, true);
  assert.equal(r.chosenMax, 60);
  assert.ok(r.sweepOpen.every(([, w], i, a) => i === 0 || w >= a[i - 1][1] * 0.93));
});
await check('readings that stay inconsistent leave the maximum as it was', async () => {
  const hc3 = rig({ params: { 40: 10, 60: 20, 61: 70, 71: 0, 72: 1 }, glitch: { 60: Array(40).fill(5) } });
  const r = await H.calibrate_dimmer(hc3, { deviceId: 3750 });
  assert.equal(r.reliable, false);
  assert.equal(r.chosenMax, 70);
  assert.equal(hc3.P[61], 70);
  assert.equal(hc3.P[40], 10);
  assert.match(r.summary, /did not make sense/);
});
await check('a plateau at 85% or above is left alone', async () => {
  const r = await H.calibrate_dimmer(rig({ sat: 92 }), { deviceId: 3750 });
  assert.equal(r.chosenMax, 99);
  assert.match(r.summary, /no headroom/);
});

console.log('sync_dimmer_tuner');
await check('writes the register and keeps tuned minimums', async () => {
  const hc3 = rig({ params: { 40: 10, 60: 22, 61: 70, 71: 0, 72: 1 } });
  const r = await H.sync_dimmer_tuner(hc3, {});
  assert.equal(r.quickAppId, 5079);
  assert.equal(r.dimmers, 1);
  const reg = JSON.parse(hc3.vars[0].value);
  assert.deepEqual([reg[0].min, reg[0].max, reg[0].tunedMin, reg[0].room], [22, 70, 14, 'Kitchen']);
});

console.log('set_device_parameter size guard');
await check('a size that contradicts the template is refused, nothing sent', async () => {
  const hc3 = rig({ model: 'fgd212' });
  await assert.rejects(zwave.handlers.set_device_parameter(hc3, { deviceId: 3749, parameterNumber: 50, size: 2, value: 10 }), /1 byte\(s\) in the device's template; you sent size 2/);
  assert.ok(!hc3.calls.some(c => c.method === 'POST'));
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
