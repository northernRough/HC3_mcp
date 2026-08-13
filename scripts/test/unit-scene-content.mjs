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

function fakeHc3(type = 'lua', isRunning = false) {
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
        type,
        roomId: 367,
        enabled: false,
        isRunning,
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

// ---------------------------------------------------------------------------
// patch_scene_content
// ---------------------------------------------------------------------------

const patchScene = scenes.handlers.patch_scene_content;

await check('patches actions by default, leaving conditions byte-identical', async () => {
  const hc3 = fakeHc3();
  const r = await patchScene(hc3, {
    sceneId: 645,
    edits: [{ old: 'local step900 = 900', new: 'local step900 = 9999' }],
  });
  assert.equal(r.written, true);
  assert.equal(r.block, 'actions');
  assert.equal(r.editsApplied, 1);
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET', 'PUT', 'GET']);
  const sent = JSON.parse(hc3.calls.find(c => c.method === 'PUT').body.content);
  assert.equal(sent.conditions, CONDITIONS, 'the untouched block must survive exactly');
  assert.ok(sent.actions.includes('local step900 = 9999'));
});

await check('the response carries the diff, not the scene body', async () => {
  const r = await patchScene(fakeHc3(), {
    sceneId: 645,
    edits: [{ old: 'local step900 = 900', new: 'local step900 = 9999' }],
  });
  const size = JSON.stringify(r).length;
  assert.ok(r.diff.includes('+  local step900 = 9999') || r.diff.includes('+local step900 = 9999'));
  assert.ok(!JSON.stringify(r).includes('local step1700'), 'body must not be echoed');
  assert.ok(size < ACTIONS.length / 20, `response ${size}B vs body ${ACTIONS.length}B`);
});

await check('block="conditions" patches the other half', async () => {
  const hc3 = fakeHc3();
  const r = await patchScene(hc3, {
    sceneId: 645,
    block: 'conditions',
    edits: [{ old: 'all', new: 'any' }],
  });
  assert.equal(r.block, 'conditions');
  const sent = JSON.parse(hc3.calls.find(c => c.method === 'PUT').body.content);
  assert.equal(sent.actions, ACTIONS, 'actions must survive exactly');
  assert.ok(sent.conditions.includes('any'));
});

await check('a non-matching edit writes nothing', async () => {
  const hc3 = fakeHc3();
  await assert.rejects(
    () => patchScene(hc3, { sceneId: 645, edits: [{ old: 'not in the scene', new: 'x' }] }),
    /patch_scene_content refused edit 1 of 1/
  );
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET']);
});

await check('dryRun returns the diff and writes nothing', async () => {
  const hc3 = fakeHc3();
  const r = await patchScene(hc3, {
    sceneId: 645,
    edits: [{ old: 'local step900 = 900', new: 'local step900 = 9999' }],
    dryRun: true,
  });
  assert.equal(r.written, false);
  assert.equal(r.dryRun, true);
  assert.equal(r.editsMatched, 1);
  assert.ok(r.hashWouldBe && r.hashWouldBe !== r.hashBefore);
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET']);
});

await check('expectedHash refuses a scene that moved under us', async () => {
  const hc3 = fakeHc3();
  await assert.rejects(
    () => patchScene(hc3, {
      sceneId: 645,
      expectedHash: '0'.repeat(32),
      edits: [{ old: 'local step900 = 900', new: 'local step900 = 9999' }],
    }),
    /has changed since you read it/
  );
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET'], 'a stale patch must not write');
});

await check('a matching expectedHash proceeds', async () => {
  const hc3 = fakeHc3();
  const probe = await patchScene(hc3, {
    sceneId: 645,
    edits: [{ old: 'local step900 = 900', new: 'local step900 = 9999' }],
    dryRun: true,
  });
  const r = await patchScene(fakeHc3(), {
    sceneId: 645,
    expectedHash: probe.hashBefore,
    edits: [{ old: 'local step900 = 900', new: 'local step900 = 9999' }],
  });
  assert.equal(r.written, true);
});

await check('a scenario scene is refused', async () => {
  await assert.rejects(
    () => patchScene(fakeHc3('scenario'), { sceneId: 645, edits: [{ old: 'a', new: 'b' }] }),
    /supports Lua scenes only/
  );
});

await check('an invalid block is refused', async () => {
  await assert.rejects(
    () => patchScene(fakeHc3(), { sceneId: 645, block: 'both', edits: [{ old: 'a', new: 'b' }] }),
    /must be "actions" or "conditions"/
  );
});

await check('a running scene is flagged', async () => {
  const r = await patchScene(fakeHc3('lua', true), {
    sceneId: 645,
    edits: [{ old: 'local step900 = 900', new: 'local step900 = 9999' }],
  });
  assert.equal(r.sceneWasRunning, true);
});

await check('broken Lua warns but still writes', async () => {
  const hc3 = fakeHc3();
  const r = await patchScene(hc3, {
    sceneId: 645,
    edits: [{ old: 'local step0 = 0', new: 'function broken()' }],
  });
  assert.equal(r.written, true, 'the checker must not block');
  assert.match(r.luaWarnings, /NOT blocking/);
  assert.match(r.luaWarnings, /block\(s\)/);
});

await check('valid Lua produces no warning field at all', async () => {
  const r = await patchScene(fakeHc3(), {
    sceneId: 645,
    edits: [{ old: 'local step900 = 900', new: 'local step900 = 9999' }],
  });
  assert.ok(!('luaWarnings' in r), 'clean Lua must not add noise');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll scene-write checks passed');
process.exit(failures ? 1 : 0);
