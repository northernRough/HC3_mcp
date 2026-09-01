#!/usr/bin/env node
// Unit test — create_scene with no `content`.
//
// `content` is not in create_scene's `required` list, so omitting it looks
// legitimate. It is not: HC3 rejects the create from inside its own Lua
// engine, one word away from the structured-conditions trap next door —
//
//   400 SceneValidationError
//   engine.lua:623: attempt to concatenate a NIL value (field 'conditions')
//
// — and names a line in Fibaro's engine rather than the missing argument.
// Four of the recurring failures in this project's friction log are this,
// filed with a single-variable reproduction: the reporter wanted an empty
// scene to populate with update_scene_content, which is reasonable.
//
// So the tool supplies a body. The body is not invented: it is
// scripts/probe.mjs's `withScene` default, which creates its throwaway scenes
// through create_scene itself, and arm 1 of probe-scene-conditions.mjs. Both
// have been accepted by a live 5.2x gateway, repeatedly.
//
//   node scripts/test/unit-scene-create-content.mjs

import { strict as assert } from 'node:assert';
import { scenes, EMPTY_LUA_SCENE_CONTENT } from '../../out/mcp/tools/scenes.js';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// Records what would go to HC3, and answers the post-create verify with it.
function fakeHc3() {
  const sent = [];
  let stored = null;
  return {
    sent,
    get stored() { return stored; },
    async request(endpoint, method = 'GET', body) {
      sent.push({ endpoint, method, body });
      if (method === 'POST' && endpoint === '/api/scenes') {
        stored = { id: 900, ...body };
        return { id: 900 };
      }
      return stored;
    },
  };
}

const BASE = { name: 'probe', type: 'lua', roomId: 219 };

await check('omitting content creates an EMPTY scene, not a scene with no body', async () => {
  const hc3 = fakeHc3();
  const res = await scenes.handlers.create_scene(hc3, { ...BASE });
  const post = hc3.sent.find(s => s.method === 'POST');
  assert.ok(post.body.content, 'no content was sent — HC3 would have 400d from its Lua engine');
  assert.deepEqual(JSON.parse(post.body.content), EMPTY_LUA_SCENE_CONTENT);
  assert.equal(res.sceneId, 900);
});

await check('the substitution is reported, not silent', async () => {
  const res = await scenes.handlers.create_scene(fakeHc3(), { ...BASE });
  assert.equal(res.contentDefaulted, true);
  assert.match(res.note, /empty body/);
  // The next call the caller needs, named in the note.
  assert.match(res.note, /update_scene_content/);
});

await check('the default body subscribes to nothing', async () => {
  // A default that fired on something would be worse than the 400: a live
  // controller would start running an empty scene on real events.
  assert.equal(EMPTY_LUA_SCENE_CONTENT.conditions, '{ conditions = {}, operator = "all" }');
  assert.equal(EMPTY_LUA_SCENE_CONTENT.actions, '');
});

await check('supplied content is never overwritten by the default', async () => {
  const hc3 = fakeHc3();
  const mine = { conditions: '{ conditions = {}, operator = "any" }', actions: 'fibaro.debug("x", "y")' };
  const res = await scenes.handlers.create_scene(hc3, { ...BASE, content: mine });
  const post = hc3.sent.find(s => s.method === 'POST');
  assert.deepEqual(JSON.parse(post.body.content), mine);
  assert.equal(res.contentDefaulted, undefined, 'reported a default it did not apply');
});

await check('an explicitly empty content string is left exactly as sent', async () => {
  const hc3 = fakeHc3();
  await scenes.handlers.create_scene(hc3, { ...BASE, content: '' });
  const post = hc3.sent.find(s => s.method === 'POST');
  assert.equal(post.body.content, '', 'rewrote a body the caller chose');
});

await check('nothing is defaulted for a scenario scene', async () => {
  // Different body shape, and nobody has tested whether it has the same
  // requirement. Inventing a default here would be a guess shipped as a fact.
  const hc3 = fakeHc3();
  const res = await scenes.handlers.create_scene(hc3, { ...BASE, type: 'scenario' });
  const post = hc3.sent.find(s => s.method === 'POST');
  assert.equal(post.body.content, undefined);
  assert.equal(res.contentDefaulted, undefined);
});

// ---------------------------------------------------------------------------
// `restart`, the concurrency control. It was hardcoded true with no argument
// to set it, while scripts/probe.mjs's `withScene` had been passing one all
// along — its own comment says a probe about re-entry must not let the flag
// vary silently, and it could not vary at all.
// ---------------------------------------------------------------------------

await check('restart defaults to true, as it always did', async () => {
  const hc3 = fakeHc3();
  await scenes.handlers.create_scene(hc3, { ...BASE });
  assert.equal(hc3.sent.find(s => s.method === 'POST').body.restart, true);
});

await check('restart:false reaches HC3 instead of being dropped', async () => {
  const hc3 = fakeHc3();
  const res = await scenes.handlers.create_scene(hc3, { ...BASE, restart: false });
  assert.equal(hc3.sent.find(s => s.method === 'POST').body.restart, false);
  assert.equal(res.restartWarning, undefined, 'warned about a flag that was applied');
});

await check('a restart HC3 did not apply is reported, not thrown', async () => {
  // The scene exists by the time the read-back happens, so throwing would
  // leave an orphan over a concurrency flag.
  const hc3 = fakeHc3();
  const inner = hc3.request.bind(hc3);
  hc3.request = async (endpoint, method = 'GET', body) => {
    const r = await inner(endpoint, method, body);
    // HC3 ignores the flag and keeps its own default.
    return method === 'GET' ? { ...r, restart: true } : r;
  };
  const res = await scenes.handlers.create_scene(hc3, { ...BASE, restart: false });
  assert.equal(res.sceneId, 900, 'the scene should still be reported as created');
  assert.match(res.restartWarning, /submitted restart=false, HC3 stored restart=true/);
  assert.match(res.restartWarning, /modify_scene/);
});

await check('no restart argument means no claim about HC3\'s default', async () => {
  // Asserting what HC3 does when the flag is omitted is untested here, so an
  // omitted flag must never produce a warning.
  const hc3 = fakeHc3();
  const inner = hc3.request.bind(hc3);
  hc3.request = async (endpoint, method = 'GET', body) => {
    const r = await inner(endpoint, method, body);
    return method === 'GET' ? { ...r, restart: false } : r;
  };
  const res = await scenes.handlers.create_scene(hc3, { ...BASE });
  assert.equal(res.restartWarning, undefined);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll create-content checks passed');
process.exit(failures ? 1 : 0);
