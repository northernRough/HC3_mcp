#!/usr/bin/env node
// Unit test — MCP Resources. No live HC3: the client is faked.
//
// resources/list previously returned [] and the server declared only
// tools:{} in its capabilities. These four read-only views are the first
// resources on the surface.
//
// The security check matters most: a binder QuickApp carries HC3_USER /
// HC3_PASS in the same quickAppVariables array as its binding cache, so a
// resource that dumped the array would publish credentials into a document
// the client renders. The binder resource must read one named variable.
//
// The binder id in these fixtures is deliberately NOT the 4826 this resource
// used to hardcode. That id was one gateway's, which made the resource inert
// or misleading for everyone else and fragile for its own author, since
// re-including the QuickApp would renumber it. Using a different id here means
// these tests fail if anything ever assumes a fixed one again.
//
//   node scripts/test/unit-resources.mjs

import { listResources, readResource, RESOURCES } from '../../out/mcp/resources.js';
import { strict as assert } from 'node:assert';

const NOW = 1786482227;

// Descriptors as they appear in the binder QA's config.lua. The resource
// parses these to tell an orphaned cache entry apart from missing hardware.
const BINDER_CONFIG = `
bind("Hall.lights", {
    main  = { id = 1, name = "main",  type = "com.fibaro.binarySwitch" },
    spare = { id = 2, name = "spare", type = "com.fibaro.binarySwitch" },
})
bind("Guest.blinds", {
    bedroom = { id = 2640, name = "blind (Gu-bed)", type = "com.fibaro.FGR223" },
})
`;

/** Not 4826, on purpose. See the header. */
const BINDER_ID = 5150;

function fakeHc3({ devices, globals, binderVars, binderFiles, quickApps } = {}) {
  const asked = [];
  const files = binderFiles ?? { config: BINDER_CONFIG };
  // The QuickApp list the resource discovers from. `quickApps: []` simulates a
  // gateway that runs no binder at all.
  const qas = quickApps ?? [{
    id: BINDER_ID,
    name: 'deviceBinder',
    properties: { quickAppVariables: binderVars ?? [] },
  }];
  return {
    asked,
    config: { host: '192.0.2.10', port: 80, username: 'u', password: 'p' },
    async request(endpoint) {
      asked.push(endpoint);
      if (endpoint === '/api/settings/info') return { timestamp: NOW, softVersion: '5.210.12', serialNumber: 'HC3-1', hcName: 'HC3-Test' };
      if (endpoint === '/api/devices') return devices ?? [];
      if (endpoint === '/api/devices?interface=quickApp') return qas;
      if (endpoint === '/api/globalVariables') return globals ?? [];
      if (endpoint === `/api/devices/${BINDER_ID}`) {
        return { id: BINDER_ID, properties: { quickAppVariables: binderVars ?? [] } };
      }
      if (endpoint === `/api/quickApp/${BINDER_ID}/files`) {
        if (files === 'unreadable') throw new Error('files endpoint down');
        return Object.keys(files).map(name => ({ name }));
      }
      const m = endpoint.match(new RegExp(`^/api/quickApp/${BINDER_ID}/files/(.+)$`));
      if (m) return { name: m[1], content: files[decodeURIComponent(m[1])] ?? '' };
      throw new Error(`unexpected endpoint ${endpoint}`);
    },
  };
}

const DEVICES = [
  { id: 9, name: 'KNX Engine', roomID: 0, type: 'com.fibaro.knxEngine', enabled: true, properties: { dead: true } },
  { id: 100, name: 'Live light', roomID: 5, type: 'com.fibaro.binarySwitch', enabled: true, properties: { dead: false } },
  { id: 200, name: 'Flat sensor', roomID: 5, type: 'com.fibaro.doorSensor', enabled: true, properties: { dead: false, batteryLevel: 12 } },
  { id: 201, name: 'Fine sensor', roomID: 5, type: 'com.fibaro.doorSensor', enabled: true, properties: { dead: false, batteryLevel: 90 } },
  { id: 300, name: 'Retired', roomID: 5, type: 'com.fibaro.binarySwitch', enabled: false, properties: { dead: false } },
];

const GLOBALS = [
  { name: 'RoomMgrHeartbeat', value: String(NOW - 30), modified: NOW - 30 },
  { name: 'WateringHeartbeat', value: String(NOW - 4000), modified: NOW - 4000 },
  { name: 'RoomMgrWatchdogLastPush', value: '0', modified: NOW - 86400 },
  { name: 'isDark', value: 'true', modified: NOW - 7200 },
  { name: 'BinderBindings', value: JSON.stringify({ 'Garden.irrigation': { a: 1, b: 2 }, 'Hall.lights': { c: 3 } }), modified: NOW },
  { name: 'DeadDeviceWatch_State', value: JSON.stringify({
    lastRun: NOW - 600,
    devices: { 3581: { lastSeenDead: true, failCount: 3, okCount: 1, lastAction: 'reconfigure', lastTriedAt: NOW - 900 },
               3582: { lastSeenDead: false, failCount: 0, okCount: 14, lastAction: 'none', lastTriedAt: NOW - 100 } },
  }), modified: NOW - 600 },
];

const BINDER_VARS = [
  { name: 'HC3_USER', value: 'admin' },
  { name: 'HC3_PASS', value: 'sup3rs3cret-do-not-leak' },
  { name: 'deviceBindings', value: JSON.stringify({
    savedAt: NOW - 300,
    cache: {
      'Hall.lights.main': { id: 1, name: 'main', lastMethod: 'L0_cached' },
      'Hall.lights.spare': { id: 2, name: 'spare', lastMethod: 'L0_cached' },
      'Garden.irrigation.south': { id: 3, name: 'south', lastMethod: 'L5_missing' },
    },
    history: [{ at: NOW - 90000, role: 'Den.x', kind: 'HEALED', method: 'L1_endpoint', old: 10, new: 11 }],
  }) },
];

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
const read = (hc3, uri) => readResource(hc3, uri).then(r => r.contents[0].text);

await check('list exposes every resource with uri/name/description/mimeType', async () => {
  const list = listResources();
  assert.equal(list.length, 5);
  assert.deepEqual(list.map(r => r.uri).sort(),
    ['hc3://binder', 'hc3://friction', 'hc3://globals', 'hc3://health', 'hc3://watchdog']);
  for (const r of list) {
    for (const f of ['uri', 'name', 'description', 'mimeType']) {
      assert.ok(r[f], `${r.uri} missing ${f}`);
    }
    assert.equal(r.mimeType, 'text/markdown');
    assert.ok(!('read' in r), 'list must not leak the read handler');
  }
});

await check('an unknown uri throws and names the valid ones', async () => {
  await assert.rejects(() => readResource(fakeHc3(), 'hc3://nope'), /Unknown resource/);
  await assert.rejects(() => readResource(fakeHc3(), 'hc3://nope'), /hc3:\/\/health/);
});

await check('health names dead devices and flags low batteries', async () => {
  const text = await read(fakeHc3({ devices: DEVICES }), 'hc3://health');
  assert.match(text, /Dead \/ unreachable — 1/);
  assert.match(text, /KNX Engine/);
  assert.ok(!/Live light/.test(text), 'a healthy device must not appear in the dead table');
  assert.match(text, /1 battery-powered.*below 30%|2 battery-powered, 1 below 30%/s);
  assert.match(text, /12%/);
  assert.ok(!/90%/.test(text), 'a healthy battery must not be listed as an outlier');
  assert.match(text, /Disabled — 1/);
  assert.match(text, /5\.210\.12/);
});

await check('health reports cleanly when nothing is wrong', async () => {
  const text = await read(fakeHc3({ devices: [DEVICES[1]] }), 'hc3://health');
  assert.match(text, /Dead \/ unreachable — 0/);
  assert.match(text, /Nothing reporting dead/);
  assert.match(text, /No device below 30%/);
});

await check('watchdog computes age and flags the stale beat', async () => {
  const text = await read(fakeHc3({ globals: GLOBALS }), 'hc3://watchdog');
  assert.match(text, /2 found, 1 stale/);
  assert.match(text, /\| RoomMgr \|.*fresh/);
  assert.match(text, /\| Watering \|.*\*\*STALE\*\*/);
  assert.match(text, /owning QuickApp has stopped ticking/);
});

await check('watchdog says so when no heartbeats exist at all', async () => {
  const text = await read(fakeHc3({ globals: [] }), 'hc3://watchdog');
  assert.match(text, /0 found, 0 stale/);
  assert.match(text, /that is itself the finding/);
});

await check('watchdog tolerates a heartbeat that is not an epoch', async () => {
  const text = await read(fakeHc3({ globals: [{ name: 'BadHeartbeat', value: 'yes', modified: NOW }] }), 'hc3://watchdog');
  assert.match(text, /not an epoch/);
  assert.match(text, /\*\*STALE\*\*/);
});

await check('binder counts resolution methods and lists non-L0 roles', async () => {
  const text = await read(fakeHc3({ globals: GLOBALS, binderVars: BINDER_VARS }), 'hc3://binder');
  assert.match(text, /2 groups, 3 fields/);
  assert.match(text, /Resolver cache — 3 roles/);
  assert.match(text, /L0_cached.*\| 2 \|/);
  // Garden.irrigation.south has no descriptor in BINDER_CONFIG, so it is
  // reported as an orphan rather than as missing hardware. The dedicated
  // cross-check test below covers the distinction in full.
  assert.match(text, /Orphaned cache entries — 1/);
  assert.match(text, /Garden\.irrigation\.south/);
  assert.match(text, /Heal history — 1 events/);
  assert.match(text, /10 → 11/);
  assert.match(text, /BinderParamDrift` is not set/);
});

await check('cross-check separates missing hardware from an orphaned entry', async () => {
  // Hall.lights.main/spare are declared; Guest.blinds.bedroom is declared but
  // its device is gone (re-include it); Garden.irrigation.south is NOT
  // declared, so it is a leftover to prune. The old code lumped the last two
  // together as "not resolving at L0".
  const vars = [{ name: 'deviceBindings', value: JSON.stringify({
    savedAt: NOW - 300,
    cache: {
      'Hall.lights.main': { id: 1, name: 'main', lastMethod: 'L0_cached' },
      'Guest.blinds.bedroom': { id: 2640, name: 'blind (Gu-bed)', type: 'com.fibaro.FGR223', lastMethod: 'L5_missing' },
      'Garden.irrigation.south': { id: 4627, name: 'South face sprinklers', lastMethod: 'L5_missing' },
    },
    history: [],
  }) }];
  const text = await read(fakeHc3({ globals: GLOBALS, binderVars: vars }), 'hc3://binder');

  assert.match(text, /Read 3 declared roles/);
  assert.match(text, /Hardware missing — 1/);
  assert.match(text, /Orphaned cache entries — 1/);

  // Each must appear under its own heading, not the other's.
  const hw = text.slice(text.indexOf('Hardware missing'), text.indexOf('Orphaned cache entries'));
  const orph = text.slice(text.indexOf('Orphaned cache entries'), text.indexOf('Healed away from L0'));
  assert.match(hw, /Guest\.blinds\.bedroom/);
  assert.ok(!/Garden\.irrigation\.south/.test(hw), 'an orphan must not be listed as missing hardware');
  assert.match(orph, /Garden\.irrigation\.south/);
  assert.ok(!/Guest\.blinds\.bedroom/.test(orph), 'missing hardware must not be listed as an orphan');

  // The two need opposite responses, so each carries its own instruction.
  assert.match(hw, /re-include the device/);
  assert.match(orph, /prune/i);
});

await check('cross-check says so when descriptors cannot be read', async () => {
  const vars = [{ name: 'deviceBindings', value: JSON.stringify({
    cache: { 'A.b': { id: 1, lastMethod: 'L5_missing' } }, history: [],
  }) }];
  const text = await read(fakeHc3({ globals: GLOBALS, binderVars: vars, binderFiles: 'unreadable' }), 'hc3://binder');
  assert.match(text, /Could not read descriptors/);
  // Without descriptors it must not guess: no orphan section at all, and the
  // entry falls back to the missing-hardware list rather than being dropped.
  assert.ok(!/Orphaned cache entries/.test(text), 'must not claim an orphan count it cannot compute');
  assert.match(text, /Hardware missing — 1/);
});

await check('a fully healthy binder reports zero in every category', async () => {
  const vars = [{ name: 'deviceBindings', value: JSON.stringify({
    cache: { 'Hall.lights.main': { id: 1, lastMethod: 'L0_cached' },
             'Hall.lights.spare': { id: 2, lastMethod: 'L0_cached' } },
    history: [],
  }) }];
  const text = await read(fakeHc3({ globals: GLOBALS, binderVars: vars }), 'hc3://binder');
  assert.match(text, /Hardware missing — 0/);
  assert.match(text, /Orphaned cache entries — 0/);
  assert.match(text, /Healed away from L0 — 0/);
  assert.match(text, /Every cached role is still declared/);
});

await check('SECURITY: the binder resource never emits QA credentials', async () => {
  const text = await read(fakeHc3({ globals: GLOBALS, binderVars: BINDER_VARS }), 'hc3://binder');
  assert.ok(!/sup3rs3cret/.test(text), 'HC3_PASS value leaked into the resource');
  assert.ok(!/HC3_PASS/.test(text), 'HC3_PASS name leaked into the resource');
  assert.ok(!/HC3_USER/.test(text), 'HC3_USER leaked into the resource');
  assert.ok(!/admin/.test(text), 'HC3_USER value leaked into the resource');
});

await check('binder degrades honestly when its cache is unreadable', async () => {
  const text = await read(fakeHc3({ globals: GLOBALS, binderVars: [] }), 'hc3://binder');
  assert.match(text, /Could not read `deviceBindings`/);
  assert.ok(!/Resolver cache — \d+ roles/.test(text), 'must not claim a role count it does not have');
});

await check('the binder QuickApp is discovered, not assumed', async () => {
  const hc3 = fakeHc3({ globals: GLOBALS, binderVars: BINDER_VARS });
  const text = await read(hc3, 'hc3://binder');
  // Found by the variable that carries what this resource renders, and it
  // reports which device it settled on, so a wrong guess is visible rather
  // than silently shaping the whole document.
  assert.match(text, new RegExp(`Binder QuickApp ${BINDER_ID}`));
  assert.match(text, /deviceBindings` variable on "deviceBinder"/);
  assert.ok(hc3.asked.includes('/api/devices?interface=quickApp'), 'never attempted discovery');
  assert.ok(!hc3.asked.some(e => /4826/.test(e)), 'still reaching for the old hardcoded id');
});

await check('a consumer\'s hydrated copy does not win over the binder itself', async () => {
  // The bug this pins, found on a live gateway: a CONSUMER QuickApp had
  // hydrated its own `deviceBindings` copy — same variable name, same
  // top-level shape — so "first QuickApp with the variable" picked the
  // consumer and rendered its stale 5-role cache as though it were the
  // binder's 275. Nothing failed; it just described the wrong device.
  const hc3 = fakeHc3({
    globals: GLOBALS,
    binderVars: BINDER_VARS,
    quickApps: [
      // Deliberately first in the list, and holding the same variable.
      { id: 4742, name: 'roomManager', properties: { quickAppVariables: [{ name: 'deviceBindings', value: '{"cache":{}}' }] } },
      { id: BINDER_ID, name: 'deviceBinder', properties: { quickAppVariables: BINDER_VARS } },
    ],
  });
  const text = await read(hc3, 'hc3://binder');
  assert.match(text, new RegExp(`Binder QuickApp ${BINDER_ID}`));
  assert.ok(!/4742/.test(text), 'picked the consumer that merely holds a copy');
  // If it had chosen the consumer, the fake would have been asked for it.
  assert.ok(!hc3.asked.includes('/api/devices/4742'), 'read the consumer instead of the binder');
});

await check('two plausible binders: reports the ambiguity instead of guessing', async () => {
  const text = await read(fakeHc3({
    globals: GLOBALS,
    quickApps: [
      { id: 11, name: 'deviceBinder', properties: { quickAppVariables: [{ name: 'deviceBindings', value: '{}' }] } },
      { id: 12, name: 'deviceBinder OLD', properties: { quickAppVariables: [{ name: 'deviceBindings', value: '{}' }] } },
    ],
  }), 'hc3://binder');
  assert.match(text, /More than one QuickApp/);
  assert.match(text, /11/);
  assert.match(text, /12/);
  assert.match(text, /HC3_BINDER_DEVICE_ID/);
  // Must not invent a report about whichever it happened to see first.
  assert.ok(!/Resolver cache — \d+ roles/.test(text));
});

await check('a gateway with no binder is told so, and it does not read as a fault', async () => {
  const text = await read(fakeHc3({ globals: GLOBALS, quickApps: [] }), 'hc3://binder');
  assert.match(text, /No binder QuickApp found/);
  assert.match(text, /not a fault/i);
  // It must explain what the pattern IS, or the reader cannot tell whether
  // they ought to have one.
  assert.match(text, /HC3_BINDER_DEVICE_ID/);
  // And it must not invent findings from a gateway it never read.
  assert.ok(!/Resolver cache/.test(text));
  assert.ok(!/Hardware missing/.test(text));
});

await check('HC3_BINDER_DEVICE_ID overrides discovery', async () => {
  const prev = process.env.HC3_BINDER_DEVICE_ID;
  process.env.HC3_BINDER_DEVICE_ID = String(BINDER_ID);
  try {
    // No discoverable QuickApp at all: the env var alone must get there.
    const hc3 = fakeHc3({ globals: GLOBALS, binderVars: BINDER_VARS, quickApps: [] });
    const text = await read(hc3, 'hc3://binder');
    assert.match(text, /HC3_BINDER_DEVICE_ID/);
    assert.match(text, /Resolver cache/);
    assert.ok(!hc3.asked.includes('/api/devices?interface=quickApp'), 'an explicit id should not need a search');
  } finally {
    if (prev === undefined) delete process.env.HC3_BINDER_DEVICE_ID;
    else process.env.HC3_BINDER_DEVICE_ID = prev;
  }
});

await check('the globals resource stays silent about a watcher that is not there', async () => {
  // Absence of a community pattern is not a finding. The global still shows up
  // in the structured table like any other; what must not appear is a section
  // implying something is missing or broken.
  const withoutWatcher = GLOBALS.filter(g => g.name !== 'DeadDeviceWatch_State');
  const text = await read(fakeHc3({ globals: withoutWatcher }), 'hc3://globals');
  assert.ok(!/Dead-device watcher/.test(text), 'reported on a watcher this gateway does not run');
  assert.ok(!/absent or unparseable/.test(text));
  assert.match(text, /isDark/, 'should still render the ordinary globals');
});

await check('globals splits scalars from structured and decodes the dead-device watcher', async () => {
  const text = await read(fakeHc3({ globals: GLOBALS }), 'hc3://globals');
  assert.match(text, /`isDark` \| true/);
  assert.match(text, /Structured globals — 2/);
  assert.match(text, /Watching 2 devices/);
  assert.match(text, /Currently flagged dead: \*\*1\*\*/);
  assert.match(text, /3581/);
  // Heartbeats have their own resource; excluding them keeps this one legible.
  assert.ok(!/RoomMgrHeartbeat/.test(text), 'heartbeats should not be duplicated here');
  // Large JSON is summarised, not dumped.
  assert.ok(!/lastSeenDead/.test(text), 'raw JSON should be summarised, not pasted');
});

await check('every resource renders without throwing on empty gateway data', async () => {
  for (const r of RESOURCES) {
    const text = await read(fakeHc3({ devices: [], globals: [], binderVars: [] }), r.uri);
    assert.ok(typeof text === 'string' && text.length > 0, `${r.uri} produced nothing`);
    assert.match(text, /^# /, `${r.uri} should open with a markdown heading`);
  }
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll resource checks passed');
process.exit(failures ? 1 : 0);
