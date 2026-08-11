#!/usr/bin/env node
// Unit test — get_icon path construction / placeholder rejection, and
// delete_icon's in-use guard. No live HC3: fetch is stubbed and the client
// is faked.
//
// Cover for the 11 Aug 2026 v2 bug report:
//   §5  device icons are NOT under a "device" or {deviceType} segment — each
//       icon set is its own directory ({iconSetName}/{iconSetName}[state]).
//       HC3 answers 200 with a placeholder for missing assets, so the old
//       code returned the "unknown icon" SVG as a success for device fetches.
//   §6  delete_icon deleted on first call with no in-use check; the reporter
//       removed a live user icon with it.
//
//   node scripts/test/unit-icon-paths.mjs

import { icons } from '../../out/mcp/tools/icons.js';
import { strict as assert } from 'node:assert';

const getIcon = icons.handlers.get_icon;
const deleteIcon = icons.handlers.delete_icon;
const CONFIG = { host: '10.0.1.3', port: 80, username: 'u', password: 'p' };
const realFetch = globalThis.fetch;

const UNKNOWN_ICON_SVG = Buffer.alloc(1888);   // HC3's placeholder, exact size
const SPA_INDEX = Buffer.alloc(13047);
const REAL_PNG = Buffer.from('real png bytes');

// Serve only the paths in `served`; everything else gets a placeholder,
// exactly as the gateway behaves.
function stubFetch(served) {
  const asked = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    asked.push(path);
    const hit = served[path];
    if (hit) {
      return { ok: true, status: 200,
        headers: { get: () => hit.mime },
        async arrayBuffer() { return hit.body; } };
    }
    const placeholder = path.startsWith('/assets/icon/fibaro')
      ? { mime: 'image/svg+xml', body: UNKNOWN_ICON_SVG }
      : { mime: 'text/html', body: SPA_INDEX };
    return { ok: true, status: 200,
      headers: { get: () => placeholder.mime },
      async arrayBuffer() { return placeholder.body; } };
  };
  return asked;
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
  finally { globalThis.fetch = realFetch; }
}

await check('device icon resolves to {iconSetName}/{iconSetName}0.{ext}', async () => {
  const asked = stubFetch({
    '/assets/icon/fibaro/zraszacz/zraszacz0.png': { mime: 'image/png', body: REAL_PNG },
  });
  const r = await getIcon({ config: CONFIG }, { category: 'device', name: 'zraszacz', extension: 'png' });
  assert.equal(r.path, '/assets/icon/fibaro/zraszacz/zraszacz0.png');
  assert.equal(r.mime, 'image/png');
  // The unsuffixed file is tried first, then state 0.
  assert.deepEqual(asked, [
    '/assets/icon/fibaro/zraszacz/zraszacz.png',
    '/assets/icon/fibaro/zraszacz/zraszacz0.png',
  ]);
});

await check('an unsuffixed device file wins when present', async () => {
  const asked = stubFetch({
    '/assets/icon/fibaro/light/light.png': { mime: 'image/png', body: REAL_PNG },
  });
  const r = await getIcon({ config: CONFIG }, { category: 'device', name: 'light', extension: 'png' });
  assert.equal(r.path, '/assets/icon/fibaro/light/light.png');
  assert.equal(asked.length, 1, 'must stop at the first hit');
});

await check('explicit state pins one exact path', async () => {
  const asked = stubFetch({
    '/assets/icon/fibaro/light/light3.png': { mime: 'image/png', body: REAL_PNG },
  });
  const r = await getIcon({ config: CONFIG }, { category: 'device', name: 'light', extension: 'png', state: 3 });
  assert.equal(r.path, '/assets/icon/fibaro/light/light3.png');
  assert.deepEqual(asked, ['/assets/icon/fibaro/light/light3.png']);
});

await check('deviceType never appears in the path', async () => {
  const asked = stubFetch({});
  await assert.rejects(() => getIcon({ config: CONFIG }, { category: 'device', name: 'zraszacz', extension: 'png' }));
  assert.ok(!asked.some(p => p.includes('com.fibaro')), `deviceType leaked into ${asked.join(', ')}`);
  assert.ok(!asked.some(p => p.includes('/device/')), `bare "device" segment used: ${asked.join(', ')}`);
});

await check('the 1888-byte unknown-icon SVG is refused, not returned', async () => {
  stubFetch({});   // every path yields the placeholder
  await assert.rejects(
    () => getIcon({ config: CONFIG }, { category: 'device', name: 'IrrigationSystemV2', extension: 'svg' }),
    /unknown icon|could not fetch/,
  );
});

await check('the SPA index.html is refused too', async () => {
  stubFetch({});
  await assert.rejects(
    () => getIcon({ config: CONFIG }, { category: 'device', name: 'User1025', extension: 'png', userIcon: true }),
    /web UI index|could not fetch/,
  );
});

await check('the user-device gap is called out in the error', async () => {
  stubFetch({});
  await assert.rejects(
    () => getIcon({ config: CONFIG }, { category: 'device', name: 'User1025', extension: 'png', userIcon: true }),
    /not served under any known/,
  );
});

await check('room and scene layouts (incl. user "scenes" vs built-in "scena")', async () => {
  stubFetch({ '/assets/icon/fibaro/rooms/Armchair.svg': { mime: 'image/svg+xml', body: Buffer.alloc(2610) } });
  const room = await getIcon({ config: CONFIG }, { category: 'room', name: 'Armchair', extension: 'svg' });
  assert.equal(room.path, '/assets/icon/fibaro/rooms/Armchair.svg');

  stubFetch({ '/assets/userIcons/scenes/User1001.png': { mime: 'image/png', body: REAL_PNG } });
  const userScene = await getIcon({ config: CONFIG }, { category: 'scene', name: 'User1001', extension: 'png', userIcon: true });
  assert.equal(userScene.path, '/assets/userIcons/scenes/User1001.png');

  stubFetch({ '/assets/icon/fibaro/scena/morning.png': { mime: 'image/png', body: REAL_PNG } });
  const builtinScene = await getIcon({ config: CONFIG }, { category: 'scene', name: 'morning', extension: 'png' });
  assert.equal(builtinScene.path, '/assets/icon/fibaro/scena/morning.png');
});

// --- delete_icon in-use guard ------------------------------------------

function fakeHc3({ devices = [], rooms = [], scenes = [], throwOn = null } = {}) {
  let listCalls = 0;
  return {
    config: CONFIG,
    async request(endpoint, method) {
      if (endpoint === throwOn) throw new Error('boom');
      if (endpoint.startsWith('/api/icons')) {
        if (method === 'DELETE') return {};
        listCalls++;
        // First call = before (icon present), later = after (icon gone).
        return listCalls === 1
          ? { device: [{ id: 1026, iconSetName: 'User1026', fileExtension: 'png' }], room: [], scene: [] }
          : { device: [], room: [], scene: [] };
      }
      if (endpoint === '/api/devices') return devices;
      if (endpoint === '/api/rooms') return rooms;
      if (endpoint === '/api/scenes') return scenes;
      return [];
    },
  };
}
const DEL_ARGS = { name: 'User1026', fileExtension: 'png', category: 'device' };

await check('delete_icon refuses when a device still references the icon', async () => {
  // A fresh client per assertion: the fake's first /api/icons call is the
  // "before" listing, so reusing one would report the icon as already gone.
  const owner = [{ id: 4742, name: 'roomManager', properties: { deviceIcon: 1026 } }];
  await assert.rejects(() => deleteIcon(fakeHc3({ devices: owner }), DEL_ARGS), /still referenced by 1 object/);
  await assert.rejects(() => deleteIcon(fakeHc3({ devices: owner }), DEL_ARGS), /roomManager/);
  await assert.rejects(() => deleteIcon(fakeHc3({ devices: owner }), DEL_ARGS), /cannot be recovered/);
});

await check('delete_icon proceeds when nothing references it', async () => {
  const hc3 = fakeHc3({ devices: [{ id: 4742, name: 'roomManager', properties: { deviceIcon: 999 } }] });
  const r = await deleteIcon(hc3, DEL_ARGS);
  assert.equal(r.deleted, 'User1026');
});

await check('force: true overrides the in-use refusal', async () => {
  const hc3 = fakeHc3({ devices: [{ id: 4742, name: 'roomManager', properties: { deviceIcon: 1026 } }] });
  const r = await deleteIcon(hc3, { ...DEL_ARGS, force: true });
  assert.equal(r.deleted, 'User1026');
});

await check('a failed in-use scan refuses rather than assuming unused', async () => {
  const hc3 = fakeHc3({ throwOn: '/api/devices' });
  await assert.rejects(() => deleteIcon(hc3, DEL_ARGS), /could not verify whether/);
  const forced = await deleteIcon(fakeHc3({ throwOn: '/api/devices' }), { ...DEL_ARGS, force: true });
  assert.equal(forced.deleted, 'User1026');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll icon-path checks passed');
process.exit(failures ? 1 : 0);
