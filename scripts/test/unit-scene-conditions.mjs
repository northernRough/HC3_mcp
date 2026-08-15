#!/usr/bin/env node
// Unit test — a scene's conditions/actions must be Lua SOURCE STRINGS.
//
// Replays a failure that reached live telemetry. A create_scene call carrying
// conditions as a structure drew, from HC3's own Lua engine:
//
//   400 SceneValidationError
//   engine.lua:623: attempt to concatenate a table value (field 'conditions')
//
// Reproduced against firmware 5.2x before this guard existed: the structured
// form fails exactly so, the same scene with a Lua source string is accepted.
// The error names a line in Fibaro's engine, not the argument at fault, which
// is why it has to be refused here rather than left to the gateway.
//
//   node scripts/test/unit-scene-conditions.mjs

import { strict as assert } from 'node:assert';
import { scenes } from '../../out/mcp/tools/scenes.js';
import { toLuaSource } from '../../out/mcp/lua.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// A request that reaches HC3 is a test failure: every case below must be
// refused locally, so the client is never constructed.
const hc3 = new Proxy({}, { get() { throw new Error('reached HC3 — the guard did not refuse'); } });
const create = args => scenes.handlers.create_scene(hc3, args);
const update = args => scenes.handlers.update_scene_content(hc3, args);

const BASE = { name: 'probe', type: 'lua', roomId: 219 };
const STRUCTURED = { conditions: [], operator: 'all' };

const refusal = async fn => {
  try { await fn(); return null; }
  catch (e) { return e.message; }
};

check('toLuaSource renders a conditions table as Lua, not JSON', () => {
  const lua = toLuaSource({
    conditions: [{ id: 2699, isTrigger: true, operator: '==', property: 'value', type: 'device', value: false }],
    operator: 'any',
  });
  assert.match(lua, /conditions = \{/);
  assert.match(lua, /isTrigger = true/);
  assert.match(lua, /operator = "any"/);
  assert.ok(!/"conditions":/.test(lua), 'rendered JSON, not Lua');
  assert.ok(!/\bnull\b/.test(lua), 'JSON null leaked into Lua output');
});

check('toLuaSource brackets keys that are not Lua identifiers', () => {
  assert.match(toLuaSource({ 'not-an-ident': 1 }), /\["not-an-ident"\] = 1/);
  assert.equal(toLuaSource({}), '{}');
  assert.equal(toLuaSource([]), '{}');
  assert.equal(toLuaSource(null), 'nil');
});

await (async () => {
  check('create_scene refuses an OBJECT content whose conditions is a table', await (async () => {
    const msg = await refusal(() => create({ ...BASE, content: { conditions: STRUCTURED, actions: 'x' } }));
    return () => {
      assert.ok(msg, 'the structured form was accepted');
      assert.match(msg, /must be a Lua source STRING/);
      assert.match(msg, /concatenate a table value/);
      assert.match(msg, /operator = "all"/);      // prints the Lua to send instead
    };
  })());

  check('create_scene refuses a JSON STRING content whose conditions is a table', await (async () => {
    // This is the path live telemetry arrived by.
    const msg = await refusal(() => create({
      ...BASE,
      content: JSON.stringify({ conditions: STRUCTURED, actions: 'x' }),
    }));
    return () => {
      assert.ok(msg, 'the JSON-string form was accepted');
      assert.match(msg, /must be a Lua source STRING/);
    };
  })());

  check('create_scene refuses a structured ACTIONS block too', await (async () => {
    const msg = await refusal(() => create({ ...BASE, content: { conditions: '{}', actions: { a: 1 } } }));
    return () => {
      assert.ok(msg, 'a structured actions block was accepted');
      assert.match(msg, /`actions` must be a Lua source STRING/);
    };
  })());

  check('update_scene_content refuses a structured conditions block', await (async () => {
    const msg = await refusal(() => update({ sceneId: 1, conditions: STRUCTURED }));
    return () => {
      assert.ok(msg, 'the structured form was accepted');
      assert.match(msg, /update_scene_content: `conditions` must be a Lua source STRING/);
    };
  })());

  check('a plain Lua body string is NOT treated as scene content', await (async () => {
    // Not JSON, so there are no blocks to check — it must pass the guard and
    // only then fail by reaching the (absent) gateway.
    const msg = await refusal(() => create({ ...BASE, content: 'fibaro.debug("x", "y")' }));
    return () => {
      assert.ok(msg, 'expected it to proceed to the request');
      assert.match(msg, /reached HC3/, `guard wrongly refused a plain body: ${msg}`);
    };
  })());

  check('valid string blocks pass the guard', await (async () => {
    const msg = await refusal(() => create({
      ...BASE,
      content: { conditions: '{ conditions = {}, operator = "all" }', actions: 'fibaro.debug("x", "y")' },
    }));
    return () => {
      assert.ok(msg, 'expected it to proceed to the request');
      assert.match(msg, /reached HC3/, `guard wrongly refused a valid scene: ${msg}`);
    };
  })());
})();

console.log(failures ? `\n${failures} failure(s)` : '\nAll scene-conditions checks passed');
process.exit(failures ? 1 : 0);
