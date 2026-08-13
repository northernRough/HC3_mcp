#!/usr/bin/env node
// Unit test — call_ui_event's receipt, and the write receipts on the QuickApp
// file tools.
//
// All three used to hand back whatever HC3 returned, which for callUIEvent is
// nothing at all and for a file PUT is {name, isMain, isOpen}. In both cases
// the caller could not tell a delivered write from one that fell on the floor,
// and had to fetch again to find out — which is the silent-success shape the
// rest of this server goes out of its way to close.
//
//   node scripts/test/unit-ui-event.mjs

import { plugins } from '../../out/mcp/tools/plugins.js';
import { quickapps } from '../../out/mcp/tools/quickapps.js';
import { strict as assert } from 'node:assert';

const callUiEvent = plugins.handlers.call_ui_event;
const updateFile = quickapps.handlers.update_quickapp_file;
const updateMany = quickapps.handlers.update_multiple_quickapp_files;

const BOUND = { name: 'modeSelector', eventType: 'onReleased', callback: 'modeSelection' };

function fakeDeviceHc3({ callbacks = [BOUND], failDeviceRead = false } = {}) {
  const calls = [];
  return {
    calls,
    async request(endpoint, method = 'GET') {
      calls.push({ endpoint, method });
      if (endpoint.startsWith('/api/devices/')) {
        if (failDeviceRead) throw new Error('HTTP 404: Not Found - no such device');
        return { id: 4950, properties: { uiCallbacks: callbacks } };
      }
      return '';   // HC3's callUIEvent answers with an empty body
    },
  };
}

function fakeFileHc3() {
  const calls = [];
  const store = new Map();
  return {
    calls,
    async request(endpoint, method = 'GET', body) {
      calls.push({ endpoint, method, body });
      if (endpoint.endsWith('/files') && method === 'GET') {
        return [...store.keys()].map(name => ({ name, isMain: name === 'main', isOpen: false }));
      }
      if (endpoint.endsWith('/files') && method === 'PUT') {
        for (const f of body) store.set(f.name, f.content);
        return body.map(f => ({ name: f.name, isMain: f.isMain, isOpen: f.isOpen }));
      }
      const name = decodeURIComponent(endpoint.split('/files/')[1] ?? '');
      if (method === 'PUT') {
        store.set(name, body.content);
        return { name, isMain: false, isOpen: false };
      }
      return { name, isMain: false, isOpen: false, content: store.get(name) ?? '' };
    },
  };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// --- call_ui_event ---------------------------------------------------------

await check('reports the binding it found and what it dispatched', async () => {
  const hc3 = fakeDeviceHc3();
  const r = await callUiEvent(hc3, { deviceId: 4950, elementName: 'modeSelector', eventType: 'onReleased' });
  assert.deepEqual(r.dispatched, { deviceId: 4950, elementName: 'modeSelector', eventType: 'onReleased' });
  assert.deepEqual(r.boundCallback, BOUND);
  assert.ok(!('warning' in r), 'a bound element must not warn');
});

await check('the binding is read BEFORE the event is dispatched', async () => {
  const hc3 = fakeDeviceHc3();
  await callUiEvent(hc3, { deviceId: 4950, elementName: 'modeSelector', eventType: 'onReleased' });
  assert.ok(hc3.calls[0].endpoint.startsWith('/api/devices/'), 'device read must come first');
  assert.ok(hc3.calls[1].endpoint.includes('callUIEvent'));
});

await check('an unbound element warns but still dispatches', async () => {
  const hc3 = fakeDeviceHc3({ callbacks: [] });
  const r = await callUiEvent(hc3, { deviceId: 4950, elementName: 'ghost', eventType: 'onReleased' });
  assert.equal(r.boundCallback, null);
  assert.match(r.warning, /No uiCallbacks entry binds 'ghost'/);
  assert.ok(hc3.calls.some(c => c.endpoint.includes('callUIEvent')), 'must not refuse — HC3 may still route it');
});

await check('a wrong eventType on a known element is treated as unbound', async () => {
  const r = await callUiEvent(fakeDeviceHc3(), {
    deviceId: 4950, elementName: 'modeSelector', eventType: 'onToggled',
  });
  assert.equal(r.boundCallback, null);
  assert.match(r.warning, /onToggled/);
});

await check('a failed binding lookup does not block the dispatch', async () => {
  const hc3 = fakeDeviceHc3({ failDeviceRead: true });
  const r = await callUiEvent(hc3, { deviceId: 4950, elementName: 'x', eventType: 'onReleased' });
  assert.match(r.bindingLookupError, /404/);
  assert.ok(!('warning' in r), 'cannot claim "unbound" when the lookup itself failed');
  assert.ok(hc3.calls.some(c => c.endpoint.includes('callUIEvent')));
});

await check('points at the trace line as the confirmation path', async () => {
  const r = await callUiEvent(fakeDeviceHc3(), {
    deviceId: 4950, elementName: 'modeSelector', eventType: 'onReleased',
  });
  assert.match(r.confirmWith, /get_debug_messages/);
  assert.match(r.confirmWith, /UIEvent/);
});

await check('value is echoed and url-encoded', async () => {
  const hc3 = fakeDeviceHc3();
  const r = await callUiEvent(hc3, {
    deviceId: 4950, elementName: 'slider', eventType: 'onChanged', value: 'a b',
  });
  assert.equal(r.dispatched.value, 'a b');
  assert.ok(hc3.calls.some(c => c.endpoint.includes('value=a%20b')));
});

// --- file write receipts ---------------------------------------------------

await check('update_quickapp_file returns a hash, not HC3 PUT echo', async () => {
  const r = await updateFile(fakeFileHc3(), { deviceId: 4933, fileName: 'main', content: 'local x = 1' });
  assert.equal(r.verified, true);
  assert.equal(r.bytes, 'local x = 1'.length);
  assert.match(r.contentHash, /^[0-9a-f]{32}$/);
  assert.equal(r.fileName, 'main');
});

await check('update_quickapp_file without content reports it did not verify', async () => {
  const r = await updateFile(fakeFileHc3(), { deviceId: 4933, fileName: 'main', isOpen: true });
  assert.equal(r.verified, false, 'nothing was compared, so do not claim verified');
});

await check('update_multiple_quickapp_files returns per-file hashes', async () => {
  const r = await updateMany(fakeFileHc3(), {
    deviceId: 4933,
    files: [
      { fileName: 'main', content: 'local a = 1' },
      { fileName: 'watering', content: 'local b = 2' },
    ],
  });
  assert.equal(r.verified, true);
  assert.equal(r.filesWritten, 2);
  assert.equal(r.files.length, 2);
  for (const f of r.files) {
    assert.match(f.contentHash, /^[0-9a-f]{32}$/, `${f.fileName} needs a hash`);
    assert.ok(f.bytes > 0);
  }
  assert.notEqual(r.files[0].contentHash, r.files[1].contentHash);
});

await check('the hash matches what get_quickapp_file would report', async () => {
  const hc3 = fakeFileHc3();
  await updateFile(hc3, { deviceId: 4933, fileName: 'main', content: 'local x = 1' });
  const written = await updateFile(hc3, { deviceId: 4933, fileName: 'main', content: 'local x = 2' });
  const read = await quickapps.handlers.get_quickapp_file(hc3, { deviceId: 4933, fileName: 'main' });
  assert.equal(written.contentHash, read.contentHash, 'a write receipt must be comparable to a read');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll ui-event and write-receipt checks passed');
process.exit(failures ? 1 : 0);
