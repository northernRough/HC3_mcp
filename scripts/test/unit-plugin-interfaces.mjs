#!/usr/bin/env node
// Unit test — manage_plugin_interfaces.
//
// The tool was a bare passthrough with a one-line description. Every recorded
// attempt against it returned "HTTP 403: Forbidden" with no body, and the
// reporter spent a create-and-inspect cycle plus three findings establishing
// that the refusal is not about which interface or which direction: add and
// delete, one interface and three, on freshly-created QuickApps of two types,
// all refused, device unchanged each time.
//
// Settled 1 Sep 2026 on device 3385, a dead Fibaro FGBS-222: a non-QuickApp
// device is refused too, for add AND delete, with its interfaces and its
// `modified` timestamp byte-identical afterwards. So the refusal is not about
// the device class either. What remains unseparated is credentials versus
// firmware, since only one credential set (administrator) exists to test
// with — the error must not collapse that into a single cause.
//
//   node scripts/test/unit-plugin-interfaces.mjs

import { strict as assert } from 'node:assert';
import { plugins } from '../../out/mcp/tools/plugins.js';
import { HC3HttpError } from '../../out/mcp/hc3-client.js';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

const run = args => plugins.handlers.manage_plugin_interfaces(hc3Ref.current, args);
const hc3Ref = { current: null };

// `interfaces` is whatever the device reports; `onPost` decides what the
// endpoint does. Nothing here contacts a gateway.
function fakeHc3({ interfaces = ['autoTurnOff', 'light', 'quickApp'], onPost } = {}) {
  let current = [...interfaces];
  return {
    get interfaces() { return current; },
    async request(endpoint, method = 'GET', body) {
      if (endpoint === '/api/plugins/interfaces' && method === 'POST') {
        const res = onPost ? onPost(body, current) : null;
        if (res instanceof Error) throw res;
        if (Array.isArray(res)) current = res;
        return { ok: true };
      }
      return { id: 4952, name: 'Shading', interfaces: current };
    },
  };
}

const forbidden = () => new HC3HttpError(403, 'Forbidden', 'POST', '/api/plugins/interfaces', '');
const BASE = { action: 'delete', deviceId: 4952, interfaces: ['light'] };

// ---------------------------------------------------------------------------
// Argument guards — the tool had none.
// ---------------------------------------------------------------------------

await check('a bad action is refused before any request', async () => {
  hc3Ref.current = new Proxy({}, { get() { throw new Error('reached HC3'); } });
  await assert.rejects(() => run({ ...BASE, action: 'remove' }), /action must be "add" or "delete"/);
  await assert.rejects(() => run({ ...BASE, interfaces: [] }), /non-empty interfaces array/);
  await assert.rejects(() => run({ ...BASE, deviceId: '4952' }), /numeric deviceId/);
});

// ---------------------------------------------------------------------------
// The 403 — the only outcome anyone has recorded.
// ---------------------------------------------------------------------------

await check('a 403 carries what the findings and the probe established', async () => {
  hc3Ref.current = fakeHc3({ onPost: () => forbidden() });
  const err = await run(BASE).then(() => null, e => e);
  assert.ok(err, 'expected a throw');
  // The device state, so the caller need not go and look.
  assert.match(err.message, /Device 4952 is unchanged \(interfaces still \["autoTurnOff","light","quickApp"\]\)/);
  // Narrowing the list is the obvious next move and is known not to help.
  assert.match(err.message, /not about which interface, which direction/);
  // Both workarounds, so nobody pays the create-and-inspect cycle again.
  assert.match(err.message, /useEmbededView/);
  assert.match(err.message, /deviceRole/);
});

await check('the 403 states the settled scope and points at the catalogue', async () => {
  hc3Ref.current = fakeHc3({ onPost: () => forbidden() });
  const err = await run(BASE).then(() => null, e => e);
  // The device-class arm, which is what makes "retrying differently will not
  // help" a claim rather than a guess.
  assert.match(err.message, /non-QuickApp Z-Wave device/);
  assert.match(err.message, /retrying differently will not help/);
  assert.match(err.message, /dead_endpoints/);
  // Nothing was written, so the caller need not go and check.
  assert.match(err.message, /Nothing is written/);
});

await check('a non-403 error is propagated untouched', async () => {
  const boom = new HC3HttpError(500, 'Internal Server Error', 'POST', '/api/plugins/interfaces', '');
  hc3Ref.current = fakeHc3({ onPost: () => boom });
  assert.equal(await run(BASE).then(() => null, e => e), boom);
});

// ---------------------------------------------------------------------------
// If the endpoint ever answers, the answer has to be evidence.
// ---------------------------------------------------------------------------

await check('a delete that works is verified against a read-back', async () => {
  hc3Ref.current = fakeHc3({ onPost: (_b, cur) => cur.filter(i => i !== 'light') });
  const res = await run(BASE);
  assert.deepEqual(res.interfacesBefore, ['autoTurnOff', 'light', 'quickApp']);
  assert.deepEqual(res.interfacesAfter, ['autoTurnOff', 'quickApp']);
  assert.equal(res.verified, true);
  assert.equal(res.changed, true);
  // A success here contradicts every recorded attempt, so it is worth filing.
  assert.match(res.note, /report_finding/);
});

await check('an accepted call that changed nothing is reported, not called success', async () => {
  // The shape this server exists to close: HC3 says yes, the read-back says no.
  hc3Ref.current = fakeHc3({ onPost: (_b, cur) => cur });
  const res = await run(BASE);
  assert.equal(res.verified, false);
  assert.equal(res.changed, false);
  assert.match(res.warning, /still present \["light"\]/);
  assert.match(res.warning, /reported as successful and was not applied/);
});

await check('an add is verified in the other direction', async () => {
  hc3Ref.current = fakeHc3({ onPost: (_b, cur) => cur });
  const res = await run({ action: 'add', deviceId: 4952, interfaces: ['energy'] });
  assert.equal(res.verified, false);
  assert.match(res.warning, /still missing \["energy"\]/);
});

await check('an unreadable device still attempts the write', async () => {
  // The attempt's own error is the more useful one; a device this tool cannot
  // read is not a reason to refuse before trying.
  hc3Ref.current = {
    async request(endpoint, method = 'GET', body) {
      if (endpoint === '/api/plugins/interfaces' && method === 'POST') throw forbidden();
      throw new HC3HttpError(404, 'Not Found', 'GET', endpoint, '');
    },
  };
  const err = await run(BASE).then(() => null, e => e);
  assert.match(err.message, /HTTP 403 Forbidden from HC3/);
  assert.doesNotMatch(err.message, /interfaces still/);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll plugin-interface checks passed');
process.exit(failures ? 1 : 0);
