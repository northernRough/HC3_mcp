#!/usr/bin/env node
// Unit test — 4.36.0, Tier 2 of the 13 Nov friction triage: misleading errors
// and usability. Fake clients only.
//
//   node scripts/test/unit-tier2.mjs

import { strict as assert } from 'node:assert';

const { devices } = await import('../../out/mcp/tools/devices.js');
const { quickapps } = await import('../../out/mcp/tools/quickapps.js');
const { globals } = await import('../../out/mcp/tools/globals.js');
const { zwave } = await import('../../out/mcp/tools/zwave.js');
const { HC3HttpError } = await import('../../out/mcp/hc3-client.js');
const D = devices.handlers, Q = quickapps.handlers;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`); }
}
const nf = (m = 'GET', ep = '/x') => new HC3HttpError(404, 'Not Found', m, ep, '');

/** A device store with PUT merging, optional 404-on-PUT. */
function devHc3(rec, opts = {}) {
  const calls = []; let r = JSON.parse(JSON.stringify(rec));
  return { calls, get rec() { return r; }, async request(ep, method = 'GET', body) {
    calls.push({ ep, method, body });
    if (opts.missing) throw nf(method, ep);
    if (ep === `/api/devices/${r.id}`) {
      if (method === 'PUT') {
        if (opts.put404) throw nf('PUT', ep);
        const { properties, ...top } = body;
        r = { ...r, ...top, properties: { ...r.properties, ...(properties ?? {}) } };
        if (opts.dropIsLight) delete r.properties.isLight;
        return {};
      }
      return JSON.parse(JSON.stringify(r));
    }
    if (ep.startsWith(`/api/devices/${r.id}/properties/`)) throw nf();
    if (opts.extra) return opts.extra(ep, method, body);
    throw new Error(`unexpected ${method} ${ep}`);
  } };
}

// ------------------------------------------------------------ 1: modify_device
console.log('modify_device');
await check('properties sent as a JSON string are accepted', async () => {
  const hc3 = devHc3({ id: 5020, name: 'qa', properties: {} });
  const r = await D.modify_device(hc3, { deviceId: 5020, properties: '{"saveLogs": false}' });
  assert.equal(r.verified, true);
  assert.equal(hc3.rec.properties.saveLogs, false);
});
await check('a non-JSON string is refused plainly, not with a TypeError', async () => {
  await assert.rejects(D.modify_device(devHc3({ id: 5020, properties: {} }), { deviceId: 5020, properties: 'oops' }), /must be an object; got a string that is not JSON/);
});
await check('404 on an existing device names the refused type change', async () => {
  await assert.rejects(D.modify_device(devHc3({ id: 4953, name: 'Shading old', parentId: 0, properties: {} }, { put404: true }), { deviceId: 4953, topLevel: { type: 'com.fibaro.multilevelSensor' } }),
    e => /exists, but HC3 answered 404/.test(e.message) && /`type` cannot be changed/.test(e.message));
});
await check('404 for viewLayout on a QuickApp child points at uiView', async () => {
  await assert.rejects(D.modify_device(devHc3({ id: 5047, name: 'child', parentId: 4710, properties: {} }, { put404: true }), { deviceId: 5047, properties: { viewLayout: { $jason: {} } }, allowUnsafeViewLayout: true }),
    /takes its custom UI as `uiView`/);
});
await check('404 for a device that does not exist says so', async () => {
  await assert.rejects(D.modify_device(devHc3({ id: 7777, properties: {} }, { missing: true }), { deviceId: 7777, topLevel: { name: 'x' } }), /no device 7777 on this HC3/);
});
await check('isLight:false that HC3 removes is not a mismatch', async () => {
  const hc3 = devHc3({ id: 5020, name: 'tv', properties: { isLight: true } }, { dropIsLight: true });
  const r = await D.modify_device(hc3, { deviceId: 5020, properties: { deviceRole: 'TvSet', isLight: false } });
  assert.equal(r.verified, true);
});

// ------------------------------------------------------------ 2 + 3: reads
console.log('get_device_info / get_device_property');
await check('get_device_info names a missing device', async () => {
  await assert.rejects(D.get_device_info(devHc3({ id: 3748 }, { missing: true }), { deviceId: 3748 }), /no device 3748 on this HC3/);
});
await check('get_device_property points top-level fields at get_device_info', async () => {
  const hc3 = devHc3({ id: 4638, name: 'OW', parentId: 4600, interfaces: ['quickAppChild'], properties: { value: 1 } });
  await assert.rejects(D.get_device_property(hc3, { deviceId: 4638, propertyName: 'parentId' }),
    e => /top-level field/.test(e.message) && /4600/.test(e.message) && /get_device_info/.test(e.message));
});

// ------------------------------------------------------------ 4: control_device
console.log('control_device');
function qaWithSource(device, files, parentFiles) {
  const calls = [];
  return { calls, async request(ep, method = 'GET') {
    calls.push({ ep, method });
    if (ep === `/api/devices/${device.id}`) return device;
    const m = ep.match(/^\/api\/quickApp\/(\d+)\/files(?:\/(.+))?$/);
    if (m) {
      const src = Number(m[1]) === device.id ? files : parentFiles;
      if (!src) throw nf();
      if (!m[2]) return Object.keys(src).map(name => ({ name }));
      return { content: src[decodeURIComponent(m[2])] };
    }
    if (ep.includes('/action/') && method === 'POST') return null;
    throw new Error(ep);
  } };
}
const DAIKIN = { id: 4710, name: 'Daikin AC', interfaces: ['quickApp'], actions: { setThermostatMode: 1 } };
await check('an undeclared method that exists in the QA source is dispatched', async () => {
  const hc3 = qaWithSource(DAIKIN, { main: '-- x\nfunction QuickApp:dumpCapabilities(id)\nend\n' });
  const r = await D.control_device(hc3, { deviceId: 4710, action: 'dumpCapabilities', args: ['96fb'] });
  assert.match(r, /defined in the QuickApp's source \(main:2\)/);
  assert.ok(hc3.calls.some(c => c.method === 'POST' && c.ep.endsWith('/action/dumpCapabilities')));
});
await check('a method that exists nowhere is refused and nothing is sent', async () => {
  const hc3 = qaWithSource(DAIKIN, { main: 'function QuickApp:onInit() end' });
  await assert.rejects(D.control_device(hc3, { deviceId: 4710, action: 'dumpCapabilites' }), /no `function <Class>:dumpCapabilites\(` exists/);
  assert.ok(!hc3.calls.some(c => c.method === 'POST'));
});
await check("a child's method is looked up in its parent's source", async () => {
  const child = { id: 4736, name: 'Daikin child', parentId: 4710, interfaces: ['quickAppChild'], actions: { turnOn: 1 } };
  const hc3 = qaWithSource(child, null, { main: 'function DaikinChild:setFanSpeed(v)\nend' });
  const r = await D.control_device(hc3, { deviceId: 4736, action: 'setFanSpeed', args: [2] });
  assert.match(r, /main:1/);
});

// ------------------------------------------------------------ 5: get_quickapps
console.log('get_quickapps');
const QAS = [{ id: 4984, name: 'Shading', type: 'com.fibaro.genericDevice', roomID: 1, enabled: true, visible: true, parentId: 0, interfaces: ['quickApp'],
               properties: { quickAppVariables: [{}, {}], viewLayout: { huge: 'x'.repeat(5000) } } }];
await check('compact by default', async () => {
  const r = await Q.get_quickapps({ request: async () => QAS }, {});
  assert.deepEqual(Object.keys(r[0]).sort(), ['enabled', 'id', 'interfaces', 'name', 'parentId', 'roomID', 'type', 'variables', 'visible']);
  assert.equal(r[0].variables, 2);
});
await check('full:true returns the records', async () => {
  const r = await Q.get_quickapps({ request: async () => QAS }, { full: true });
  assert.ok(r[0].properties.viewLayout);
});

// ------------------------------------------------------------ 6: create_global_variable
console.log('create_global_variable');
await check('value omitted creates an empty string', async () => {
  const calls = [];
  const hc3 = { async request(ep, method = 'GET', body) {
    calls.push({ ep, method, body });
    if (method === 'POST') return { name: body.name, value: body.value };
    if (ep === '/api/globalVariables/PowerRecoveryMode') { if (calls.some(c => c.method === 'POST')) return { name: 'PowerRecoveryMode', value: '' }; throw nf(); }
    if (ep === '/api/globalVariables') return [];
    throw new Error(ep);
  } };
  await globals.handlers.create_global_variable(hc3, { varName: 'PowerRecoveryMode' });
  assert.equal(calls.find(c => c.method === 'POST').body.value, '');
});

// ------------------------------------------------------------ 7: child variables
console.log('child variable writes');
function childHc3() {
  const calls = []; let vars = [{ name: 'thermostatId', type: 'string', value: '3479' }];
  return { calls, async request(ep, method = 'GET', body) {
    calls.push({ ep, method, body });
    if (ep === '/api/devices/4735') {
      if (method === 'PUT') { vars = body.properties.quickAppVariables; return {}; }
      return { id: 4735, parentId: 4710, interfaces: ['quickAppChild'], properties: { quickAppVariables: vars } };
    }
    if (ep === '/api/plugins/restart') return null;
    throw new Error(ep);
  } };
}
await check('writing a child variable warns that the parent did not restart', async () => {
  const r = await Q.set_quickapp_variable(childHc3(), { deviceId: 4735, name: 'thermostatId', value: '5051' });
  assert.equal(r.child.parentRestarted, false);
  assert.match(r.child.warning, /writes its old copy back/);
});
await check('restartParent restarts the parent after the write', async () => {
  const hc3 = childHc3();
  const r = await Q.set_quickapp_variables(hc3, { deviceId: 4735, variables: { thermostatId: '5051' }, restartParent: true });
  assert.equal(r.child.parentRestarted, true);
  const restart = hc3.calls.find(c => c.ep === '/api/plugins/restart');
  assert.equal(restart.body.deviceId, 4710);
  assert.ok(hc3.calls.indexOf(restart) > hc3.calls.findIndex(c => c.method === 'PUT'), 'restart must follow the write');
});

// ------------------------------------------------------------ 8: set_device_parameter
console.log('set_device_parameter');
await check('cacheUpdated:false is not presented as failure; battery devices are flagged', async () => {
  const hc3 = { async request(ep, method = 'GET') {
    if (ep === '/api/devices/4905') return { id: 4905, name: 'toilet eye', properties: { nodeId: 147, batteryLevel: 80, wakeUpTime: 7200 } };
    if (ep.startsWith('/api/zwave/configuration_parameters/')) return { items: [{ parameterNumber: 12, configurationValue: 0, size: 1 }] };
    if (method === 'POST') return { result: null };
    throw new Error(ep);
  } };
  const r = await zwave.handlers.set_device_parameter(hc3, { deviceId: 4905, parameterNumber: 12, size: 1, value: 1 });
  assert.equal(r.cacheUpdated, false);
  assert.match(r.outcome, /NOT a failure signal/);
  assert.match(r.outcome, /BATTERY device/);
  assert.equal(r.batteryDevice, true);
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
