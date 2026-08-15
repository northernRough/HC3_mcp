#!/usr/bin/env node
// Probe — what shape does HC3 accept for a scene's `conditions` block?
//
// Raised by live telemetry: a create_scene call on the deployed server drew
//
//   HTTP 400 SceneValidationError
//   engine.lua:623: attempt to concatenate a table value (field 'conditions')
//
// The suspicion is create_scene's own convenience path. It JSON.stringify's a
// `content` object, so a caller who supplies conditions as a STRUCTURE (the
// obvious reading, and what every conditions example in the wild looks like)
// sends {"conditions":{...}} where HC3 wants a Lua SOURCE STRING.
//
// Three arms, one variable each: the conditions value.
//
//   node scripts/probe-scene-conditions.mjs

import { client } from './probe.mjs';

const ARMS = [
  ['lua source string', '{ conditions = {}, operator = "all" }'],
  ['JS object', { conditions: [], operator: 'all' }],
  ['JSON string', JSON.stringify({ conditions: [], operator: 'all' })],
];

const hc3 = await client();
const { scenes } = await import('../out/mcp/tools/scenes.js');
const rooms = await hc3.request('/api/rooms');
const roomId = rooms?.[0]?.id;
if (typeof roomId !== 'number') throw new Error('no room available to create a scene in');

for (const [label, conditions] of ARMS) {
  console.log(`\n  [arm] conditions as a ${label}`);
  let sceneId = null;
  try {
    const created = await scenes.handlers.create_scene(hc3, {
      name: `PROBE cond ${label}`.slice(0, 50),
      type: 'lua',
      roomId,
      content: { conditions, actions: 'fibaro.debug("PROBE", "ran")' },
    });
    sceneId = created?.sceneId ?? created?.id ?? null;
    const stored = await hc3.request(`/api/scenes/${sceneId}`);
    const parsed = JSON.parse(stored?.content ?? '{}');
    console.log(`    ACCEPTED — scene ${sceneId}`);
    console.log(`    stored conditions is a ${typeof parsed.conditions}: ${JSON.stringify(parsed.conditions).slice(0, 90)}`);
  } catch (e) {
    const msg = String(e.message);
    console.log(`    REFUSED — ${msg.slice(0, 220)}`);
    if (/concatenate a table value/.test(msg)) {
      console.log('    ^ this is the reported failure, reproduced');
    }
  } finally {
    if (sceneId) {
      try {
        await scenes.handlers.delete_scene(hc3, { sceneId });
        console.log(`    [probe] deleted scene ${sceneId}`);
      } catch (e) {
        console.error(`    [probe] FAILED to delete scene ${sceneId}: ${e.message}`);
      }
    }
  }
}
