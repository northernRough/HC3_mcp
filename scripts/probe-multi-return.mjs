#!/usr/bin/env node
// Probe — do fibaro.getGlobalVariable / fibaro.getValue return TWO values,
// and does that differ between a QuickApp and a Lua scene?
//
// Field finding (17 Nov, 4.42.0): inside a QuickApp,
// tonumber(fibaro.getGlobalVariable(name)) failed under pcall, while
// tonumber((fibaro.getGlobalVariable(name))) worked; the same unbracketed
// expression worked in a scene. Hypothesis: in a QA the call returns
// (value, modifiedTimestamp), and tonumber takes the timestamp as a base.
// The original fix bracketed three calls in one edit, so which call(s)
// misbehave was not isolated. This runs each call alone, in both runtimes,
// with identical Lua.
//
// Throwaways only: one QuickApp, one scene, an input and an output global.
// The device read is fibaro.getValue on a device id you pass (read-only;
// no fibaro.call anywhere).
//
//   node scripts/probe-multi-return.mjs <deviceId>

import { withQuickApp, withScene, withGlobal, sleep } from './probe.mjs';

const deviceId = Number(process.argv[2]);
if (!deviceId) { console.error('usage: probe-multi-return.mjs <deviceId>'); process.exit(1); }

const lua = (inG, outG) => `
local IN, OUT, DEV = "${inG}", "${outG}", ${deviceId}
local function n(...) return select('#', ...) end
local function p(f) local ok, v = pcall(f) return tostring(ok) .. ":" .. tostring(v) end
local r = {}
r.gv_count = n(fibaro.getGlobalVariable(IN))
r.gv_second = tostring((select(2, fibaro.getGlobalVariable(IN))))
r.gv_tonumber = p(function() return tonumber(fibaro.getGlobalVariable(IN)) end)
r.gv_tonumber_bracketed = p(function() return tonumber((fibaro.getGlobalVariable(IN))) end)
r.gv_local_then_tonumber = p(function() local v = fibaro.getGlobalVariable(IN) return tonumber(v) end)
r.val_count = n(fibaro.getValue(DEV, "value"))
r.val_second = tostring((select(2, fibaro.getValue(DEV, "value"))))
r.val_tonumber = p(function() return tonumber(fibaro.getValue(DEV, "value")) end)
r.val_tonumber_bracketed = p(function() return tonumber((fibaro.getValue(DEV, "value"))) end)
r.val_type = type((fibaro.getValue(DEV, "value")))
fibaro.setGlobalVariable(OUT, json.encode(r))
`;

async function waitFor(hc3, outG) {
  for (let i = 0; i < 30; i++) {
    const g = await hc3.request(`/api/globalVariables/${outG}`);
    if (g?.value && g.value !== '0') return JSON.parse(g.value);
    await sleep(1000);
  }
  const dm = await hc3.request('/api/debugMessages?last=0');
  const msgs = (dm?.messages ?? dm ?? []).slice(0, 8).map(m => `${m.tag} ${m.type}: ${String(m.message).slice(0, 300)}`);
  return { error: 'no result within 30 s', debug: msgs };
}

const results = {};
await withGlobal(async (inG) => {
  await withGlobal(async (outG, hc3) => {
    await withScene(async (sceneId, hc3s, st) => {
      await st.run_scene(hc3s, { sceneId });
      results.scene = await waitFor(hc3, outG);
    }, { actions: lua(inG, outG) });

    await hc3.request(`/api/globalVariables/${outG}`, 'PUT', { name: outG, value: '0' });

    await withQuickApp(async (qaId, hc3q) => {
      const body = `function QuickApp:onInit()\n${lua(inG, outG)}\nend\n`;
      await hc3q.request(`/api/quickApp/${qaId}/files/main`, 'PUT',
        { name: 'main', isMain: true, isOpen: false, type: 'lua', content: body });
      results.quickapp = await waitFor(hc3, outG);
    });
  });
}, { value: '12' });

console.log(JSON.stringify(results, null, 1));
console.log('\nRESULTS (input global = "12")');
const keys = [...new Set([...Object.keys(results.scene ?? {}), ...Object.keys(results.quickapp ?? {})])].sort();
console.log(`  ${'check'.padEnd(26)} ${'scene'.padEnd(40)} quickapp`);
for (const k of keys) console.log(`  ${k.padEnd(26)} ${String(results.scene?.[k]).padEnd(40)} ${results.quickapp?.[k]}`);
console.log();
