#!/usr/bin/env node
// Unit test — update_scene_content response shape. No live HC3: a fake client
// serves a scene whose body is the size of a real one (75 KB, measured on
// scene 645 of a live gateway) so the response-amplification regression this
// guards against is testable by size, not by inspection.
//
// Before 4.18.0 this tool returned `previous` + `current` + the full scene
// record — three copies of that body, ~225 KB of response for a one-line edit.
//
//   node scripts/test/unit-scene-content.mjs

import { scenes } from '../../out/mcp/tools/scenes.js';
import { strict as assert } from 'node:assert';

const updateSceneContent = scenes.handlers.update_scene_content;

const ACTIONS = Array.from({ length: 1800 }, (_, i) => `  local step${i} = ${i}`).join('\n');
const CONDITIONS = '{ conditions = {}, operator = "all" }';

function fakeHc3() {
  const calls = [];
  let stored = JSON.stringify({ conditions: CONDITIONS, actions: ACTIONS });
  return {
    calls,
    async request(endpoint, method = 'GET', body) {
      calls.push({ endpoint, method, body });
      if (method === 'PUT') {
        stored = body.content;
        return {};
      }
      return {
        id: 645,
        name: 'Watering',
        type: 'lua',
        roomId: 367,
        enabled: false,
        isRunning: false,
        content: stored,
      };
    },
  };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const NEW_ACTIONS = ACTIONS.replace('local step900 = 900', 'local step900 = 9999');

await check('default response omits the bodies and reports sizes + hashes', async () => {
  const r = await updateSceneContent(fakeHc3(), { sceneId: 645, actions: NEW_ACTIONS });
  assert.deepEqual(r.changedFields, ['actions']);
  assert.equal(r.previous.actionsLength, ACTIONS.length);
  assert.equal(r.current.actionsLength, NEW_ACTIONS.length);
  assert.equal(r.previous.conditionsLength, CONDITIONS.length);
  assert.ok(/^[0-9a-f]{32}$/.test(r.previous.contentHash));
  assert.ok(/^[0-9a-f]{32}$/.test(r.current.contentHash));
  assert.notEqual(r.previous.contentHash, r.current.contentHash);
  assert.equal(r.scene.contentOmitted, true);
  assert.equal(typeof r.scene.contentLength, 'number');
  assert.ok(!('content' in r.scene), 'the scene record must not carry the body');
  assert.equal(r.scene.name, 'Watering', 'metadata must survive');
});

await check('the response does not scale with the scene body', async () => {
  const r = await updateSceneContent(fakeHc3(), { sceneId: 645, actions: NEW_ACTIONS });
  const size = JSON.stringify(r).length;
  assert.ok(!JSON.stringify(r).includes('local step1700'), 'body must not be echoed');
  assert.ok(
    size < ACTIONS.length / 20,
    `response (${size}B) should be a small fraction of the body (${ACTIONS.length}B)`
  );
});

await check('returnContent=true restores the pre-4.18 shape', async () => {
  const r = await updateSceneContent(fakeHc3(), {
    sceneId: 645,
    actions: NEW_ACTIONS,
    returnContent: true,
  });
  assert.equal(r.previous.actions, ACTIONS);
  assert.equal(r.current.actions, NEW_ACTIONS);
  assert.equal(r.previous.conditions, CONDITIONS);
  assert.equal(typeof r.scene.content, 'string');
  assert.ok(!('contentOmitted' in r.scene));
  assert.ok(!('hint' in r));
});

await check('the unsupplied half is still preserved', async () => {
  const hc3 = fakeHc3();
  await updateSceneContent(hc3, { sceneId: 645, actions: NEW_ACTIONS });
  const put = hc3.calls.find(c => c.method === 'PUT');
  const sent = JSON.parse(put.body.content);
  assert.equal(sent.conditions, CONDITIONS, 'conditions must be carried over untouched');
  assert.equal(sent.actions, NEW_ACTIONS);
});

await check('a scene body is still written and read back exactly once each', async () => {
  const hc3 = fakeHc3();
  await updateSceneContent(hc3, { sceneId: 645, actions: NEW_ACTIONS });
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET', 'PUT', 'GET']);
});

await check('supplying neither actions nor conditions is refused', async () => {
  await assert.rejects(
    () => updateSceneContent(fakeHc3(), { sceneId: 645 }),
    /at least one of actions or conditions/
  );
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll update_scene_content checks passed');
process.exit(failures ? 1 : 0);
