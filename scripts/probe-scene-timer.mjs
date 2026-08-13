#!/usr/bin/env node
// Probe — does HC3 re-run a Lua scene from the top to service a
// fibaro.setTimeout callback?
//
// The claim arrived in a field report and has never been tested here. It is
// worth settling because it changes what a scene write is: if a pending timer
// causes the scene to be re-entered from line 1, then patching a scene with a
// timer in flight can restart it into half-applied logic, and any top-level
// side effect in a scene runs more times than its author expected.
//
//   node scripts/probe-scene-timer.mjs
//
// Needs FIBARO_* in the environment, or an `hc3` MCP server in ~/.claude.json.
// Creates a throwaway scene and two throwaway globals; all three are removed
// in `finally`. Touches no existing object and calls no device.
//
// ---------------------------------------------------------------------------
// Method
//
// The scene increments a global at the TOP of its body, and a second global
// inside a setTimeout callback. Both counters live in globals rather than in
// the debug log because the log is a convenience, not a measurement — but the
// log is read too, as an independent second witness with timestamps.
//
// Two things make this decisive rather than anecdotal:
//
//   1. The single variable is the PRESENCE OF THE TIMER. Both arms are the
//      same scene body, run the same way, for the same duration; one has a
//      setTimeout and one does not. A top-count of 2 only means something if
//      the no-timer arm scored 1.
//
//   2. The counter is sampled BEFORE the timer is due and again AFTER. A "2"
//      observed only at the end could have any cause; a 1 → 2 transition
//      across the moment the callback fires ties the second run to the
//      callback specifically.
//
// TRAP, verified here in 4.15.0 and easy to walk into: fibaro.setGlobalVariable
// SILENTLY DOES NOTHING for a global that does not already exist. If the two
// globals below were not created first, every counter would read 0, no arm
// would differ, and the probe would look like a clean refutation while
// measuring nothing at all. withGlobal creates them; do not "simplify" that
// away.
// ---------------------------------------------------------------------------

import { withScene, withGlobal, sleep, client } from './probe.mjs';

const TIMER_MS = 5000;
const SAMPLE_BEFORE_MS = 2500;   // timer not yet due
const SAMPLE_AFTER_MS = 9000;    // comfortably past it

const body = (topsVar, cbsVar, withTimer) => `
-- Probe scene. No fibaro.call anywhere: this must not be able to reach a device.
local tops = tonumber(fibaro.getGlobalVariable("${topsVar}")) or 0
fibaro.setGlobalVariable("${topsVar}", tostring(tops + 1))
fibaro.debug("probe", "TOP executed, run #" .. tostring(tops + 1))
${withTimer ? `
fibaro.setTimeout(${TIMER_MS}, function()
  local cbs = tonumber(fibaro.getGlobalVariable("${cbsVar}")) or 0
  fibaro.setGlobalVariable("${cbsVar}", tostring(cbs + 1))
  fibaro.debug("probe", "CALLBACK fired, #" .. tostring(cbs + 1))
end)
` : '-- (no timer in this arm)'}
`.trim();

async function readCounters(hc3, topsVar, cbsVar) {
  const get = async name => {
    const v = await hc3.request(`/api/globalVariables/${name}`);
    return Number(v?.value ?? 0);
  };
  return { tops: await get(topsVar), callbacks: await get(cbsVar) };
}

async function resetCounters(hc3, topsVar, cbsVar) {
  for (const name of [topsVar, cbsVar]) {
    await hc3.request(`/api/globalVariables/${name}`, 'PUT', { name, value: '0' });
  }
}

async function runArm(label, { withTimer, topsVar, cbsVar }) {
  return withScene(async (sceneId, hc3, sceneTools) => {
    await resetCounters(hc3, topsVar, cbsVar);
    console.log(`\n  [arm] ${label} — scene ${sceneId}`);

    await sceneTools.run_scene(hc3, { sceneId });

    await sleep(SAMPLE_BEFORE_MS);
    const before = await readCounters(hc3, topsVar, cbsVar);
    console.log(`    t=${SAMPLE_BEFORE_MS}ms (timer not yet due): ${JSON.stringify(before)}`);

    await sleep(SAMPLE_AFTER_MS - SAMPLE_BEFORE_MS);
    const after = await readCounters(hc3, topsVar, cbsVar);
    console.log(`    t=${SAMPLE_AFTER_MS}ms (timer has fired)   : ${JSON.stringify(after)}`);

    return { label, before, after };
  }, { actions: body(topsVar, cbsVar, withTimer) });
}

const hc3 = await client();

await withGlobal(async topsVar => {
  await withGlobal(async cbsVar => {
    console.log('\n=== Does a setTimeout callback re-run a scene from the top? ===');

    const control = await runArm('WITHOUT timer (control)', { withTimer: false, topsVar, cbsVar });
    const test = await runArm('WITH timer', { withTimer: true, topsVar, cbsVar });

    console.log('\n--- verdict ---');
    if (control.after.tops !== 1) {
      console.log(`INCONCLUSIVE: the control arm ran the top ${control.after.tops} times, not 1.`);
      console.log('Something other than the timer is re-running the scene. Find that before');
      console.log('reading anything into the test arm.');
    } else if (test.after.tops === 1) {
      console.log('REFUTED: the top ran exactly once with a timer pending, and the callback');
      console.log(`fired ${test.after.callbacks} time(s). The scene stayed alive to service its own`);
      console.log('callback; it was not re-run from the top.');
    } else if (test.before.tops === 1 && test.after.tops > 1) {
      console.log(`CONFIRMED: the top ran once before the timer was due and ${test.after.tops} times after.`);
      console.log('The re-run is tied to the callback firing, not to something at start-up.');
    } else {
      console.log(`AMBIGUOUS: tops went ${test.before.tops} -> ${test.after.tops}, callbacks ${test.after.callbacks}.`);
      console.log('The extra run was already there before the timer was due, so the timer is not');
      console.log('shown to be the cause. Re-run before reporting either way.');
    }
    console.log('\ncontrol:', JSON.stringify(control));
    console.log('test   :', JSON.stringify(test));

    // Second witness. If the globals and the log disagree, trust neither and
    // find out why before writing any of this down.
    try {
      const debug = await hc3.request('/api/debugMessages?filter=probe');
      const lines = (Array.isArray(debug) ? debug : []).slice(-12)
        .map(m => `      ${new Date((m.timestamp ?? 0) * 1000).toISOString()} ${m.message}`);
      if (lines.length) console.log('\n  debug log (independent witness):\n' + lines.join('\n'));
    } catch (e) {
      console.log(`\n  (could not read the debug log: ${e.message})`);
    }

    console.log('\nWhatever this says, record it — in CHANGELOG.md and via report_finding.');
    console.log('The last time this question was answered, the answer was not written down.');
  });
});
