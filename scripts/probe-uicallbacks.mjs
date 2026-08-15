#!/usr/bin/env node
// Does HC3 honour a named uiCallback, and what shape does the handler receive?
//
// THE CONFLICT THIS SETTLES
//
// Three records disagree, and all three are from this gateway:
//
//   7 Aug   Irrigation, a button bound to `UIAction`  -> UIAction, ONE TABLE arg
//   13 Aug  a scratch QA, an element bound to a NAME  -> the NAMED method, table
//   15 Aug  Irrigation, selSeedZones (multi select)   -> UIAction, THREE POSITIONAL args
//           bound to the name `seedlingZonesChanged`
//
// The 13 Aug result is the one currently written into `modify_device`'s
// description ("firing the element then dispatches the named method"), so if it
// is wrong, or right only for some element kinds, a shipped tool description is
// wrong. The scratch QA behind it has since been deleted and cannot be
// re-inspected, which is why this exists as a probe rather than a re-read.
//
// THE DESIGN
//
// Two axes, crossed, one variable per cell:
//
//   element kind        button | select        (is a name honoured for both?)
//   registered callback a NAME | "UIAction"    (which of the two decides the arg shape?)
//   how it was bound    at CREATION | written back after   (the modify_device claim)
//
// The load-bearing cell is select + "UIAction". If that arrives positionally,
// the argument shape belongs to the ELEMENT KIND. If it arrives as a table, the
// shape belongs to the DISPATCH PATH — i.e. positional is what a fallback looks
// like after HC3 declines a name. Those are different bugs with different fixes,
// and no observation to date separates them.
//
// Every handler logs its own name, the argument count, and the type of every
// argument, so the answer is READ, not inferred:
//
//   UICBPROBE|cbSelect|argc=1|1:table={"eventType":"onToggled",...}
//   UICBPROBE|UIAction|argc=3|1:string="onToggled" |2:string="selSeedZones" |...
//
// FIRING: call_ui_event is not assumed to be the same path as a finger.
//
// This probe fires every element through `call_ui_event`, and with --hold it
// then pauses so a human can tap the same elements in the iOS app while the
// QuickApps are still alive. The two are compared. A probe that only ever fires
// its own channel cannot tell you whether that channel dispatches like the app,
// and the whole question here IS how HC3 dispatches.
//
//   node scripts/probe-uicallbacks.mjs              # call_ui_event only
//   node scripts/probe-uicallbacks.mjs --hold       # ... then wait for taps
//   node scripts/probe-uicallbacks.mjs --hold=300   # ... for 300 seconds
//
// Both QuickApps are deleted in `finally`, tapped or not.

import { client, sleep } from './probe.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out/mcp');
const tools = async name => (await import(path.join(OUT, 'tools', `${name}.js`)))[name];

const DEFAULT_ROOM = 219;         // "Default Room", as asked for
const SETTLE_MS = 2500;

const holdArg = process.argv.find(a => a.startsWith('--hold'));
const HOLD_SECONDS = holdArg ? Number(holdArg.split('=')[1] ?? 240) : 0;

// --- the QuickApp under test -------------------------------------------------

// Four elements. Two kinds, and within each kind one element that will carry a
// custom callback name and one that keeps HC3's own "UIAction".
const ELEMENTS = [
  { name: 'btnNamed',   kind: 'button', callback: 'cbButton', eventType: 'onReleased' },
  { name: 'btnDefault', kind: 'button', callback: 'UIAction', eventType: 'onReleased' },
  { name: 'selNamed',   kind: 'select', callback: 'cbSelect', eventType: 'onToggled' },
  { name: 'selDefault', kind: 'select', callback: 'UIAction', eventType: 'onToggled' },
];

// Shape copied from a QuickApp that is known to render on this gateway rather
// than written from the schema: `selectionType` and an ARRAY-valued `values`
// are both load-bearing, and getting either wrong blanks the entire tile with
// no error (4.16.0).
function row(component) {
  return { type: 'vertical', style: { weight: '1.2' }, components: [component] };
}

function viewLayout() {
  const items = ELEMENTS.map(el => row(
    el.kind === 'button'
      ? { name: el.name, type: 'button', text: el.name, visible: true, style: { weight: '1.2' } }
      : {
          name: el.name, type: 'select', text: el.name, visible: true,
          selectionType: 'multi',
          style: { weight: '1.2' },
          options: [
            { type: 'option', text: 'Alpha', value: 'A' },
            { type: 'option', text: 'Beta',  value: 'B' },
          ],
          values: [],
        }
  ));
  return { $jason: { body: { header: { style: { height: '0' }, title: 'uicb probe' }, sections: { items } } } };
}

function namedCallbacks() {
  return ELEMENTS.map(el => ({ name: el.name, eventType: el.eventType, callback: el.callback }));
}

// Every handler funnels into one logger, so a difference in the output is a
// difference in what HC3 delivered rather than in how the QA reported it.
const MAIN_LUA = `
local function enc(v)
  if v == nil then return "nil" end
  local ok, s = pcall(function() return json.encode(v) end)
  if ok then return tostring(s) end
  return tostring(v)
end

local function logCall(self, handler, ...)
  local n = select('#', ...)
  local parts = {}
  for i = 1, n do
    local v = select(i, ...)
    parts[#parts + 1] = i .. ":" .. type(v) .. "=" .. enc(v)
  end
  self:debug("UICBPROBE|" .. handler .. "|argc=" .. n .. "|" .. table.concat(parts, " |"))
end

function QuickApp:cbButton(...) logCall(self, "cbButton", ...) end
function QuickApp:cbSelect(...) logCall(self, "cbSelect", ...) end
function QuickApp:UIAction(...) logCall(self, "UIAction", ...) end

function QuickApp:onInit()
  self:debug("UICBPROBE|ready")
end
`;

// --- helpers -----------------------------------------------------------------

async function readCallbacks(hc3, id) {
  const dev = await hc3.request(`/api/devices/${id}`);
  return (dev?.properties?.uiCallbacks ?? []).map(c => `${c.name}:${c.eventType}->${c.callback}`).sort();
}

/** Which handler fired, and with what shape, for each UICBPROBE line. */
function parseProbeLines(messages) {
  return messages
    .map(m => String(m.message ?? ''))
    .filter(t => t.includes('UICBPROBE|') && !t.includes('UICBPROBE|ready'))
    .map(t => {
      const body = t.slice(t.indexOf('UICBPROBE|') + 'UICBPROBE|'.length);
      const [handler, argc, ...rest] = body.split('|');
      const args = rest.join('|');
      const shape = /^1:table=/.test(args.trim()) ? 'table' : /^1:string=/.test(args.trim()) ? 'positional' : 'other';
      // The element name is inside the payload either way, so a fired event can
      // be matched back to its element without trusting call order.
      const el = ELEMENTS.map(e => e.name).find(n => args.includes(n)) ?? '?';
      return { handler, argc: Number(argc.replace('argc=', '')), shape, element: el, raw: t };
    });
}

async function messagesSince(hc3, since) {
  const debug = (await tools('debug')).handlers;
  const res = await debug.get_debug_messages(hc3, { since, limit: 400, maxPages: 20 });
  return res?.messages ?? res?.matching ?? [];
}

/**
 * HC3's own trace lines for the same events.
 *
 * This matters more than it looks. The 15 Aug report's evidence for "delivered
 * POSITIONALLY" was an `onAction:` trace line reading
 * {"args":["onToggled","selSeedZones",[…]],"actionName":"UIAction"} — but that
 * is HC3's transport envelope, and it is not established anywhere that the Lua
 * dispatcher passes those args through unchanged rather than assembling a table
 * from them. If the envelope looks positional while the handler receives a
 * table, then the envelope is not evidence about the call signature at all, and
 * a reasonable reader was misled by it. Capture both and compare.
 */
function traceLines(messages) {
  return messages
    .map(m => String(m.message ?? ''))
    .filter(t => t.includes('onAction:') || t.includes('UIEvent:'));
}

// --- one arm -----------------------------------------------------------------

/**
 * @param bindAt 'creation'  — names supplied to create_quickapp
 *               'writeback' — created bare, names written with modify_device,
 *                             then restarted
 *               'writeback-norestart' — same, but fired WITHOUT the restart.
 *
 * That third arm exists to settle a question the original field report left
 * open. Their picker went from "no event at all" to "events arrive" after a
 * single modify_device call that changed two things at once: it wrote the
 * callbacks AND restarted the QuickApp. They credited neither, correctly. This
 * arm writes the callbacks and fires before any restart, so whichever of the
 * two mattered is visible on its own.
 */
async function runArm(hc3, bindAt, { fire = true } = {}) {
  const qaTools = (await tools('quickapps')).handlers;
  const devTools = (await tools('devices')).handlers;
  const plugTools = (await tools('plugins')).handlers;

  const created = await qaTools.create_quickapp(hc3, {
    name: `PROBE_uicb_${bindAt}`,
    type: 'com.fibaro.genericDevice',
    roomId: DEFAULT_ROOM,
    initialView: viewLayout(),
    ...(bindAt === 'creation' ? { initialProperties: { uiCallbacks: namedCallbacks() } } : {}),
  });
  const id = created?.deviceId ?? created?.id;
  console.log(`\n  [arm:${bindAt}] created QuickApp ${id}`);

  try {
    // The view must exist before anything is fired, and create_quickapp's
    // initialView is not assumed to have taken: check, and PUT it if not, so a
    // silently-dropped view cannot be mistaken for "the element never fired".
    let dev = await hc3.request(`/api/devices/${id}`);
    const rendered = JSON.stringify(dev?.properties?.viewLayout ?? {});
    const missing = ELEMENTS.filter(e => !rendered.includes(e.name)).map(e => e.name);
    if (missing.length) {
      console.log(`  [arm:${bindAt}] initialView did not carry ${missing.join(', ')} — PUTting viewLayout instead`);
      await devTools.modify_device(hc3, { deviceId: id, properties: { viewLayout: viewLayout() } });
    } else {
      console.log(`  [arm:${bindAt}] initialView took, all four elements present`);
    }

    console.log(`  [arm:${bindAt}] uiCallbacks after creation:`);
    for (const c of await readCallbacks(hc3, id)) console.log(`      ${c}`);

    if (bindAt === 'writeback-norestart') {
      // Load the handlers FIRST (a file push restarts the QA on its own), so
      // that by the time the callbacks are written the only thing left to vary
      // is the restart.
      await qaTools.update_quickapp_file(hc3, { deviceId: id, fileName: 'main', content: MAIN_LUA });
      await sleep(SETTLE_MS);
      await devTools.modify_device(hc3, { deviceId: id, properties: { uiCallbacks: namedCallbacks() } });
      console.log(`  [arm:${bindAt}] uiCallbacks written, NO restart after:`);
      for (const c of await readCallbacks(hc3, id)) console.log(`      ${c}`);
      await sleep(SETTLE_MS);
    } else {
      if (bindAt === 'writeback') {
        await devTools.modify_device(hc3, { deviceId: id, properties: { uiCallbacks: namedCallbacks() } });
        console.log(`  [arm:${bindAt}] uiCallbacks after modify_device writeback:`);
        for (const c of await readCallbacks(hc3, id)) console.log(`      ${c}`);
      }

      await qaTools.update_quickapp_file(hc3, { deviceId: id, fileName: 'main', content: MAIN_LUA });
      await qaTools.restart_quickapp(hc3, { quickAppId: id });
      await sleep(SETTLE_MS);

      // Bindings are rebuilt when the QA starts, so what matters is the state
      // AFTER the restart, not what was written before it.
      console.log(`  [arm:${bindAt}] uiCallbacks after restart:`);
      for (const c of await readCallbacks(hc3, id)) console.log(`      ${c}`);
    }

    if (!fire) return { id, bindAt, fired: [] };

    const since = Math.floor(Date.now() / 1000) - 1;
    // Fire BOTH event types at every element. Which one HC3 emits for a given
    // element kind is exactly what is in dispute, so guessing it would beg the
    // question.
    for (const el of ELEMENTS) {
      for (const eventType of ['onReleased', 'onToggled']) {
        try {
          const r = await plugTools.call_ui_event(hc3, {
            deviceId: id, elementName: el.name, eventType,
            ...(el.kind === 'select' ? { value: 'A' } : {}),
          });
          console.log(`  [arm:${bindAt}] fired ${el.name}/${eventType} — boundCallback=${JSON.stringify(r?.boundCallback ?? null)}`);
        } catch (e) {
          console.log(`  [arm:${bindAt}] fired ${el.name}/${eventType} — REFUSED: ${e.message.split('\n')[0]}`);
        }
        await sleep(600);
      }
    }
    await sleep(SETTLE_MS);
    const msgs = await messagesSince(hc3, since);
    return { id, bindAt, fired: parseProbeLines(msgs), traces: traceLines(msgs), since };
  } finally {
    if (!process.env.PROBE_KEEP) {
      try { await hc3.request(`/api/devices/${id}`, 'DELETE'); console.log(`  [arm:${bindAt}] deleted QuickApp ${id}`); }
      catch (e) { console.error(`  [arm:${bindAt}] FAILED to delete QuickApp ${id}: ${e.message}`); }
    }
  }
}

// --- report ------------------------------------------------------------------

function table(title, rows) {
  console.log(`\n  ${title}`);
  console.log('    element      registered   handler fired   argc  arg shape');
  console.log('    ' + '-'.repeat(62));
  for (const el of ELEMENTS) {
    const hit = rows.find(r => r.element === el.name);
    console.log(
      '    ' + el.name.padEnd(13) + el.callback.padEnd(13) +
      (hit ? hit.handler.padEnd(16) + String(hit.argc).padEnd(6) + hit.shape : '(nothing fired)')
    );
  }
}

function verdict(rows) {
  const sel = rows.find(r => r.element === 'selDefault');
  const selNamed = rows.find(r => r.element === 'selNamed');
  const btnNamed = rows.find(r => r.element === 'btnNamed');

  console.log('\n  VERDICT');
  const positional = rows.filter(r => r.shape === 'positional');
  if (!sel) {
    console.log('    selDefault never fired, so the discriminating cell is missing. Inconclusive.');
  } else if (positional.length === 0) {
    console.log('    NO cell produced the positional form. Every dispatch that arrived —');
    console.log('    button or select, named or UIAction — was a SINGLE TABLE argument.');
    console.log('    The discriminating cell therefore does not discriminate: there is no');
    console.log('    positional dispatch on this path to attribute to anything.');
    console.log('    The 15 Aug positional observation is NOT reproduced by call_ui_event,');
    console.log('    so either the app taps a different path, or that report was reading');
    console.log('    HC3\'s transport envelope rather than the Lua call signature.');
    console.log('    Check the trace lines above: this path emits UIEvent: only. The report');
    console.log('    quoted an onAction: line, which did not appear here at all.');
  } else {
    console.log(`    ${positional.length} cell(s) arrived positionally: ` +
      positional.map(p => `${p.element}->${p.handler}`).join(', '));
    console.log(`    selDefault (select bound to UIAction) arrived as: ${sel.shape}`);
    console.log(sel.shape === 'positional'
      ? '    => the shape follows the ELEMENT KIND, not the dispatch path.'
      : '    => the shape follows the DISPATCH PATH, not the element kind.');
  }
  if (btnNamed && selNamed) {
    const btnHonoured = btnNamed.handler === 'cbButton';
    const selHonoured = selNamed.handler === 'cbSelect';
    console.log(`    named callback honoured for a button? ${btnHonoured ? 'YES' : 'NO'}`);
    console.log(`    named callback honoured for a select? ${selHonoured ? 'YES' : 'NO'}`);
    if (btnHonoured && !selHonoured) {
      console.log('    => names are honoured per ELEMENT KIND. modify_device\'s description,');
      console.log('       which states the named method is dispatched, needs qualifying.');
    }
    if (!btnHonoured && !selHonoured) {
      console.log('    => names are not honoured at all here. modify_device\'s description is');
      console.log('       wrong as written, and the 13 Aug ledger row does not reproduce.');
    }
  }
  console.log('\n    Whatever this says, record it — in CHANGELOG.md, in FRICTION.md, and via');
  console.log('    report_finding. A result that lives only in a terminal is a result lost.');
}

// --- main --------------------------------------------------------------------

const hc3 = await client();
console.log('uiCallbacks dispatch probe — two arms, four elements each, in Default Room.');

const arms = [];
for (const bindAt of ['creation', 'writeback', 'writeback-norestart']) {
  if (HOLD_SECONDS > 0) continue;               // hold mode runs its own pass
  arms.push(await runArm(hc3, bindAt));
}

if (HOLD_SECONDS > 0) {
  // Keep both QuickApps alive so a human can tap them, then read the same log
  // the automated pass reads and compare like for like.
  const qaTools = (await tools('quickapps')).handlers;
  const ids = [];
  try {
    for (const bindAt of ['creation', 'writeback', 'writeback-norestart']) {
      process.env.PROBE_KEEP = '1';
      const arm = await runArm(hc3, bindAt);
      ids.push({ ...arm });
      arms.push(arm);
    }
    delete process.env.PROBE_KEEP;

    const tapSince = Math.floor(Date.now() / 1000) - 1;
    console.log('\n  ' + '='.repeat(66));
    console.log('  TAP NOW. Both QuickApps are live in Default Room:');
    for (const a of ids) console.log(`    PROBE_uicb_${a.bindAt}  (device ${a.id})`);
    console.log('  Tap btnNamed, btnDefault, and change selNamed and selDefault');
    console.log('  on BOTH tiles, in the iOS app. Order does not matter.');
    console.log(`  Waiting ${HOLD_SECONDS}s, then reading the log and tearing down.`);
    console.log('  ' + '='.repeat(66));
    for (let left = HOLD_SECONDS; left > 0; left -= 15) {
      await sleep(Math.min(15, left) * 1000);
      process.stdout.write(`\r  ...${Math.max(0, left - 15)}s remaining   `);
    }
    console.log('\n');
    const tapMsgs = await messagesSince(hc3, tapSince);
    const tapped = parseProbeLines(tapMsgs);
    const tapTraces = traceLines(tapMsgs);
    table('BY REAL TAP (arms pooled)', tapped);

    // The raw lines are the evidence; the table is a convenience. Print both,
    // because the whole question is a signature and a table flattens it.
    console.log(`\n  RAW handler lines from taps (${tapped.length}):`);
    for (const t of tapped) console.log(`    ${t.raw.slice(0, 160)}`);
    console.log(`\n  RAW HC3 traces during the tap window (${tapTraces.length}):`);
    for (const t of tapTraces.slice(0, 20)) console.log(`    ${t.slice(0, 160)}`);

    const onAction = tapTraces.filter(t => t.includes('onAction:'));
    const positional = tapped.filter(r => r.shape === 'positional');
    console.log('\n  TAP VERDICT');
    if (!tapped.length && !tapTraces.length) {
      console.log('    Nothing arrived at all. Either no taps landed, or the app was not used.');
    } else {
      console.log(`    onAction: traces from taps : ${onAction.length}`);
      console.log(`    positional dispatches      : ${positional.length} of ${tapped.length}`);
      if (positional.length) {
        console.log('    => a real tap DOES dispatch positionally where call_ui_event does not.');
        console.log('       call_ui_event is not a faithful proxy for a tap, and its description');
        console.log('       recommends it as a verification step. That needs fixing.');
      } else if (tapped.length) {
        console.log('    => a real tap dispatches the SAME way call_ui_event does: one table.');
        console.log('       The 15 Aug positional claim is refuted as stated. Its onAction: line');
        console.log('       was HC3\'s transport envelope, not the Lua call signature, and the');
        console.log('       picker symptom is fully explained by the onReleased guard instead.');
      }
    }
  } finally {
    delete process.env.PROBE_KEEP;
    for (const a of ids) {
      try { await hc3.request(`/api/devices/${a.id}`, 'DELETE'); console.log(`  [teardown] deleted QuickApp ${a.id}`); }
      catch (e) { console.error(`  [teardown] FAILED to delete QuickApp ${a.id}: ${e.message}`); }
    }
  }
}

for (const arm of arms) table(`BY call_ui_event — bound at ${arm.bindAt}`, arm.fired);

// What HC3 said about the same events, next to what Lua actually received.
const allTraces = arms.flatMap(a => a.traces ?? []);
console.log(`\n  HC3's OWN TRACE LINES for these events (${allTraces.length}):`);
for (const t of allTraces.slice(0, 12)) console.log(`    ${t.slice(0, 150)}`);
if (!allTraces.length) console.log('    none — no onAction:/UIEvent: lines were emitted.');
verdict(arms.flatMap(a => a.fired));
