#!/usr/bin/env node
// Unit test — 4.35.0, the Tier 1 fixes from the 13 Nov friction triage.
// No live HC3: fake clients record requests; one real local HTTP server
// proves the client timeout message.
//
//   node scripts/test/unit-tier1.mjs

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';

process.env.HC3_EVENT_HISTORY_BUDGET_MS = '1';   // force the paging budget to trip
const { unknownArguments, missingArguments, closest } = await import('../../out/mcp/args.js');
const { devices } = await import('../../out/mcp/tools/devices.js');
const { quickapps } = await import('../../out/mcp/tools/quickapps.js');
const { system } = await import('../../out/mcp/tools/system.js');
const { HC3Client, HC3HttpError } = await import('../../out/mcp/hc3-client.js');

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`); }
}
const notFound = () => new HC3HttpError(404, 'Not Found', 'GET', '/x', '');

// ------------------------------------------------------------ 7 + 4: arguments
console.log('argument validation');
const FIND = { name: 'find_devices_by_name', inputSchema: { type: 'object', properties: { name: {}, roomId: {}, exactMatch: {}, visibleOnly: {}, topLevelOnly: {} }, required: ['name'] } };
await check("'exact' is refused and points at exactMatch", () => {
  const m = unknownArguments(FIND, { name: 'recess', exact: true });
  assert.match(m, /'exact' \(did you mean 'exactMatch'\?\)/);
  assert.match(m, /Nothing was done/);
});
await check('declared arguments pass', () => assert.equal(unknownArguments(FIND, { name: 'x', exactMatch: true }), undefined));
await check('dryRun on update_multiple_quickapp_files is refused', () => {
  const S = { name: 'update_multiple_quickapp_files', inputSchema: { properties: { deviceId: {}, files: {} } } };
  assert.match(unknownArguments(S, { deviceId: 1, files: [], dryRun: true }), /'dryRun'/);
});
await check('closest() maps file -> fileName', () => assert.equal(closest('file', ['deviceId', 'fileName']), 'fileName'));
const RF = { name: 'report_finding', inputSchema: { properties: { tool: { description: 'Tool name.' }, expected: {}, actual: {}, reproduction: {} }, required: ['tool', 'expected', 'actual', 'reproduction'] } };
await check('every missing required argument is named at once', () => {
  const m = missingArguments(RF, { expected: 'x' });
  for (const k of ['tool', 'actual', 'reproduction']) assert.match(m, new RegExp(k));
  assert.doesNotMatch(m, /expected/);
});
await check('get_quickapp_variable without name is refused, not exists:false', async () => {
  await assert.rejects(quickapps.handlers.get_quickapp_variable({ request: async () => ({}) }, { deviceId: 1 }), /requires a variable name/);
});

// ------------------------------------------------------------ 2: filter_devices
console.log('filter_devices');
const DEVS = [
  { id: 1, name: 'meter', enabled: true, parentId: 1, properties: { power: 5, value: 1 } },
  { id: 2, name: 'switch', enabled: true, parentId: 1, properties: { value: 0 } },
  { id: 3, name: 'off one', enabled: false, parentId: 1, properties: { value: 0 } },
];
function filterHc3() {
  const calls = [];
  return { calls, async request(ep, method, body) {
    calls.push({ ep, method, body });
    if (ep === '/api/devices') return DEVS;
    if (ep === '/api/devices/filter') {
      // Model HC3: hasNoProperty returns nothing; property attributes dropped.
      if (body.filters.some(f => f.filter === 'hasNoProperty')) return [];
      let r = DEVS;
      for (const f of body.filters) if (f.filter === 'enabled') r = r.filter(d => f.value.includes(d.enabled));
      return r.map(d => Object.fromEntries(body.attributes.main.filter(a => !a.startsWith('properties')).map(a => [a, d[a]])));
    }
    throw new Error(ep);
  } };
}
await check('hasNoProperty is evaluated here, combined with server filters', async () => {
  const hc3 = filterHc3();
  const r = await devices.handlers.filter_devices(hc3, { filters: [{ filter: 'hasNoProperty', value: ['power'] }, { filter: 'enabled', value: [true] }], attributes: ['id', 'name'] });
  assert.deepEqual(r, [{ id: 2, name: 'switch' }]);
  assert.ok(!hc3.calls.some(c => c.body?.filters?.some(f => f.filter === 'hasNoProperty')), 'hasNoProperty must not be sent to HC3');
});
await check('properties.X attributes are projected', async () => {
  const r = await devices.handlers.filter_devices(filterHc3(), { filters: [{ filter: 'enabled', value: [true] }], attributes: ['id', 'properties.power'] });
  assert.deepEqual(r, [{ id: 1, properties: { power: 5 } }, { id: 2, properties: { power: undefined } }]);
});
await check('a plain query still goes straight to HC3', async () => {
  const hc3 = filterHc3();
  await devices.handlers.filter_devices(hc3, { filters: [{ filter: 'enabled', value: [true] }], attributes: ['id'] });
  assert.equal(hc3.calls.length, 1);
});
await check('a null filter value is refused before sending', async () => {
  const hc3 = filterHc3();
  await assert.rejects(devices.handlers.filter_devices(hc3, { filters: [{ filter: 'roomID', value: [null] }] }), /non-null/);
  assert.equal(hc3.calls.length, 0);
});

// ------------------------------------------------------------ 3: find_devices_by_name
console.log('find_devices_by_name');
const TREE = [
  { id: 3636, name: 'ensuite node', parentId: 1, properties: {} },
  { id: 3637, name: 'ensuite spots', parentId: 3636, properties: {} },
  { id: 3634, name: 'mae ensuite spots', parentId: 1, properties: {} },
];
const treeHc3 = { request: async () => TREE };
await check('endpoint children are found', async () => {
  const r = await devices.handlers.find_devices_by_name(treeHc3, { name: 'ensuite spots', exactMatch: true });
  assert.deepEqual(r.map(d => [d.id, d.parentId]), [[3637, 3636]]);
});
await check('topLevelOnly restores the old filter', async () => {
  const r = await devices.handlers.find_devices_by_name(treeHc3, { name: 'ensuite spots', topLevelOnly: true });
  assert.deepEqual(r.map(d => d.id), [3634]);
});

// ------------------------------------------------------------ 5: delete_device
console.log('delete_device');
await check('a device that disappears a moment after DELETE is a success', async () => {
  let gets = 0, deleted = false;
  const hc3 = { async request(ep, method) {
    if (method === 'DELETE') { deleted = true; return null; }
    if (!deleted) return { id: 5070, name: 'child', interfaces: ['quickApp'] };
    if (++gets < 3) return { id: 5070 };        // still visible briefly
    throw notFound();
  } };
  await devices.handlers.delete_device(hc3, { deviceId: 5070 });
  assert.equal(gets, 3);
});

// ------------------------------------------------------------ 6: update_multiple_quickapp_files
console.log('update_multiple_quickapp_files');
function qaHc3(existing, opts = {}) {
  const store = { ...existing }, calls = [];
  return { calls, store, async request(ep, method = 'GET', body) {
    calls.push({ ep, method });
    if (ep.endsWith('/files') && method === 'GET') return Object.keys(store).map(n => ({ name: n, isMain: n === 'main' }));
    if (ep.endsWith('/files') && method === 'POST') { store[body.name] = body.content; return {}; }
    if (ep.endsWith('/files') && method === 'PUT') {
      if (opts.failPut) { store[body[0].name] = body[0].content; throw new HC3HttpError(500, 'Internal Server Error', 'PUT', ep, ''); }
      for (const f of body) { if (!(f.name in store)) throw new HC3HttpError(500, 'Internal Server Error', 'PUT', ep, ''); store[f.name] = f.content; }
      return body.map(f => ({ name: f.name }));
    }
    const n = decodeURIComponent(ep.split('/files/')[1] ?? '');
    if (n in store) return { name: n, content: store[n] };
    throw notFound();
  } };
}
await check('missing files are created first, then one PUT for the rest', async () => {
  const hc3 = qaHc3({ main: 'old' });
  const r = await quickapps.handlers.update_multiple_quickapp_files(hc3, { deviceId: 5, files: [{ fileName: 'main', content: 'new' }, { fileName: 'config', content: 'cfg' }] });
  assert.deepEqual(r.created, ['config']);
  assert.equal(hc3.calls.filter(c => c.method === 'PUT').length, 1);
  assert.deepEqual(hc3.store, { main: 'new', config: 'cfg' });
});
await check('a failed PUT reports which files were written', async () => {
  const hc3 = qaHc3({ main: 'old', engine: 'old' }, { failPut: true });
  await assert.rejects(
    quickapps.handlers.update_multiple_quickapp_files(hc3, { deviceId: 5, files: [{ fileName: 'main', content: 'new' }, { fileName: 'engine', content: 'new' }] }),
    e => /'main': WRITTEN/.test(e.message) && /'engine': unchanged/.test(e.message));
});

// ------------------------------------------------------------ 1: event history
console.log('get_event_history');
await check('a window not fully paged says so in the result', async () => {
  let n = 0;
  const hc3 = { async request(ep) {
    // Always a full page, each older than the last, so paging would continue.
    const base = 2_000_000_000 - (n++) * 2000;
    return Array.from({ length: 1000 }, (_, i) => ({ id: `${n}-${i}`, timestamp: base - i, objects: [{ id: 7, type: 'device' }] }));
  } };
  const r = await system.handlers.get_event_history(hc3, { object_id: 7, from: 1_000_000_000, limit: 50 });
  assert.equal(r.truncated, true);
  assert.match(r.note, /NOT fully covered/);
  assert.equal(r.events.length, 50);
});
await check('a timeout names the call and the limit', async () => {
  const srv = createServer((_q, res) => setTimeout(() => { res.end('[]'); }, 400)).listen(0);
  const port = srv.address().port;
  const c = new HC3Client({ host: '127.0.0.1', port, username: 'u', password: 'p' });
  await assert.rejects(c.request('/api/events/history?x=1', 'GET', undefined, { timeoutMs: 50 }), /did not answer GET \/api\/events\/history within 0 s/);
  srv.close();
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
