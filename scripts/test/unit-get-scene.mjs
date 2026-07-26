#!/usr/bin/env node
// Unit test — get_scene. No live HC3: injects a fake client returning a canned
// /api/scenes/{id} record and asserts the full record passes through, that
// includeContent=false strips the (large) content body while reporting its
// size, and that a non-numeric sceneId is rejected.
//
//   node scripts/test/unit-get-scene.mjs

import { scenes } from '../../out/mcp/tools/scenes.js';
import { strict as assert } from 'node:assert';

const getScene = scenes.handlers.get_scene;

const SCENE = {
  id: 293,
  name: 'Principle Bed 2.8 (1)',
  type: 'lua',
  roomId: 219,
  mode: 'automatic',
  enabled: true,
  isRunning: false,
  content: 'x'.repeat(142987), // large Lua body, like the real gateway
};

function fakeHc3() {
  const calls = [];
  return { calls, async request(endpoint) {
    calls.push(endpoint);
    assert.equal(endpoint, '/api/scenes/293', `unexpected endpoint ${endpoint}`);
    return SCENE;
  } };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

await check('returns the full scene record including content by default', async () => {
  const hc3 = fakeHc3();
  const r = await getScene(hc3, { sceneId: 293 });
  assert.equal(hc3.calls[0], '/api/scenes/293');
  assert.equal(r.id, 293);
  assert.equal(r.name, 'Principle Bed 2.8 (1)');
  assert.equal(typeof r.content, 'string');
  assert.equal(r.content.length, 142987);
  assert.ok(!('contentOmitted' in r));
});

await check('includeContent=false strips content and reports its length', async () => {
  const r = await getScene(fakeHc3(), { sceneId: 293, includeContent: false });
  assert.equal(r.id, 293);
  assert.equal(r.name, 'Principle Bed 2.8 (1)');
  assert.ok(!('content' in r), 'content should be stripped');
  assert.equal(r.contentOmitted, true);
  assert.equal(r.contentLength, 142987);
});

await check('includeContent=true is the same as default (content present)', async () => {
  const r = await getScene(fakeHc3(), { sceneId: 293, includeContent: true });
  assert.equal(typeof r.content, 'string');
  assert.ok(!('contentOmitted' in r));
});

await check('non-numeric sceneId throws', async () => {
  await assert.rejects(() => getScene(fakeHc3(), { sceneId: undefined }), /numeric sceneId/);
  await assert.rejects(() => getScene(fakeHc3(), { sceneId: '293' }), /numeric sceneId/);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll get_scene checks passed');
process.exit(failures ? 1 : 0);
