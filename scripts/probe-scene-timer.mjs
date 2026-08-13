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
//
// ---------------------------------------------------------------------------
// Arm 3 — closure survival, which is the thing code actually depends on
//
// Counting restarts infers the mechanism. Capturing a local in the callback
// measures the consequence directly, as one value, and separates three
// outcomes that the restart count cannot:
//
//   INSTANCE-1  the original instance survived; the closure is intact, and the
//               reported "captured value is nil" symptom has another cause
//   LOST        the upvalue is nil when the callback runs — the instance is
//               gone and the closure with it
//   INSTANCE-2  the callback ran with a LATER instance's value. The top re-ran
//               and rebuilt the closure, so `if token == savedToken` compares
//               the new run's token against itself, or against the wrong one
//
// That third case is the one that produces the reported symptom while looking
// like the second, and it needs a different fix: not "avoid closures" but
// "never trust a value that a re-entry would recompute". Worth the extra arm.
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

// Arm 3 body. `captured` exists only as an upvalue of the closure — nothing
// writes it to a global before the callback runs, so whatever the callback
// sees is what survived.
const closureBody = (topsVar, seenVar) => `
local tops = tonumber(fibaro.getGlobalVariable("${topsVar}")) or 0
fibaro.setGlobalVariable("${topsVar}", tostring(tops + 1))
local captured = "INSTANCE-" .. tostring(tops + 1)
fibaro.debug("probe", "TOP, captured=" .. captured)

fibaro.setTimeout(${TIMER_MS}, function()
  -- If the instance died, captured is nil here. If the top re-ran and
  -- rebuilt the closure, it holds the LATER run's value, not this one's.
  fibaro.setGlobalVariable("${seenVar}", tostring(captured or "LOST"))
  fibaro.debug("probe", "CALLBACK, captured=" .. tostring(captured or "LOST"))
end)
`.trim();

async function readVar(hc3, name) {
  const v = await hc3.request(`/api/globalVariables/${name}`);
  return String(v?.value ?? '');
}

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

async function runClosureArm({ topsVar, seenVar }) {
  return withScene(async (sceneId, hc3, sceneTools) => {
    await hc3.request(`/api/globalVariables/${topsVar}`, 'PUT', { name: topsVar, value: '0' });
    await hc3.request(`/api/globalVariables/${seenVar}`, 'PUT', { name: seenVar, value: 'NOTHING-WROTE-THIS' });
    console.log(`\n  [arm] CLOSURE survival — scene ${sceneId}`);

    await sceneTools.run_scene(hc3, { sceneId });
    await sleep(SAMPLE_AFTER_MS);

    const seen = await readVar(hc3, seenVar);
    const tops = Number(await readVar(hc3, topsVar));
    console.log(`    tops=${tops}, callback saw captured=${JSON.stringify(seen)}`);
    return { seen, tops };
  }, { actions: closureBody(topsVar, seenVar) });
}

const hc3 = await client();

await withGlobal(async topsVar => {
  await withGlobal(async cbsVar => {
   await withGlobal(async seenVar => {
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

    // Arm 3 — the consequence, measured directly.
    const closure = await runClosureArm({ topsVar, seenVar });
    console.log('\n--- closure verdict ---');
    if (closure.seen === 'NOTHING-WROTE-THIS') {
      console.log('INCONCLUSIVE: the callback never wrote. Either it did not fire, or the');
      console.log('global write failed. Check the debug log below before concluding anything.');
    } else if (closure.seen === 'INSTANCE-1' && closure.tops === 1) {
      console.log('CLOSURE SURVIVED: the callback saw the value captured by the run that armed');
      console.log('it. Upvalues are intact across the timer, so "captured value is nil in the');
      console.log('callback" has some other cause and the closure-free workaround is unnecessary.');
    } else if (closure.seen === 'LOST') {
      console.log('CLOSURE LOST: the upvalue was nil when the callback ran. The instance did not');
      console.log('survive. Capture nothing; re-read all state from scene variables.');
    } else if (/^INSTANCE-(\d+)$/.test(closure.seen)) {
      console.log(`CLOSURE REBUILT: the callback saw ${closure.seen} after ${closure.tops} top-level run(s).`);
      console.log('The top re-ran and rebuilt the closure, so a captured token compares against');
      console.log('the LATER run\'s value. This is the dangerous case: it looks like a nil bug but');
      console.log('the fix is different — never trust a value a re-entry would recompute.');
    } else {
      console.log(`UNEXPECTED: captured=${JSON.stringify(closure.seen)}, tops=${closure.tops}. Investigate before reporting.`);
    }
    console.log('closure:', JSON.stringify(closure));

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

    console.log('\nWhatever this says, record it — in CHANGELOG.md, in FRICTION.md, and via');
    console.log('report_finding. The last time this question was answered it was not written');
    console.log('down anywhere, which is why it is being asked again.');
   });
  });
});
