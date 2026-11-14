// Dimmer calibration: the top end by measurement, the low end by eye.
//
// What a dimmer's own "calibration" does is not enough. On 14 Nov 2026 two
// Qubino Mini Dimmers in the kitchen calibrated successfully (parameter 72 =
// 1) and still wasted the top half of the slider: their LED lamps reached full
// power at 55-60% and 55-99% did nothing. The fix was the dimmer's MAXIMUM
// level parameter, found by stepping the light and reading its power — 70 on
// both, after which every slider step brightened and 99% kept full output.
//
// calibrate_dimmer automates that. The LOW end (the lowest level before a lamp
// flickers or will not strike) cannot be measured — power is an average — so
// it is left to the Dimmer Tuner QuickApp (quickapps/dimmer-tuner), which a
// person drives from a phone while looking at the lights. A QuickApp cannot
// read Z-Wave parameters (every /zwave/ route answers 501 from inside one), so
// sync_dimmer_tuner writes it a register of the dimmers and their min/max.

import { ToolModule } from './registry';
import { readNodeParameters, zwave } from './zwave';
import { quickapps } from './quickapps';
import { readSnapshotJson } from './snapshots';

export interface DimmerProfile {
  key: string; match: string; label: string;
  min: number; max: number; size: 1 | 2 | 4;
  minLo: number; minHi: number; maxLo: number; maxHi: number;
  calibrate?: { param: number; value: number; status: number; ok: number; overwritesMinMax?: boolean };
  report?: { param: number; size: 1 | 2 | 4 };
}

/** Matched against the HC3 parameter-template description. Keep in step with
 *  PROFILES in quickapps/dimmer-tuner/main.lua. */
export const DIMMER_PROFILES: DimmerProfile[] = [
  { key: 'qubino', match: 'Mini Dimmer', label: 'Qubino Mini Dimmer', min: 60, max: 61, size: 1,
    minLo: 0, minHi: 98, maxLo: 2, maxHi: 99,
    calibrate: { param: 71, value: 2, status: 72, ok: 1 },            // 71 resets itself to 0 (watched 14 Nov 2026)
    report: { param: 40, size: 1 } },
  { key: 'fgd212', match: 'FGD212', label: 'Fibaro FGD212', min: 1, max: 2, size: 1,
    minLo: 1, minHi: 98, maxLo: 2, maxHi: 99,
    calibrate: { param: 13, value: 1, status: 14, ok: 1, overwritesMinMax: true },
    report: { param: 50, size: 1 } },
  { key: 'zen54', match: 'ZEN54', label: 'Zooz ZEN54', min: 4, max: 5, size: 1,
    minLo: 1, minHi: 45, maxLo: 55, maxHi: 99 },                       // no calibration, no metering
];

export function profileFor(description: any): DimmerProfile | undefined {
  if (typeof description !== 'string') return undefined;
  return DIMMER_PROFILES.find(p => description.includes(p.match));
}

const num = (v: any) => (v === undefined || v === null || v === '' ? NaN : Number(v));
const isMultilevel = (d: any) => d?.type === 'com.fibaro.multilevelSwitch' || d?.baseType === 'com.fibaro.multilevelSwitch';
const settleMs = () => Number(process.env.HC3_DIMMER_SETTLE_MS ?? 6000);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** "Full power" means within 5% of the peak: warm LED drivers drift a few %. */
const REACH = 0.95;

export interface DimmerEntry {
  node: number; lightId: number; rootId: number; name: string; room: string;
  model: string; min?: number; max?: number;
  report?: number;      // power-report threshold, so the QuickApp's Auto top can put it back
  meters: boolean;
}

/** The light of a node: its multilevel child, preferring one that meters power. */
function pickLight(devs: any[]): any | undefined {
  // An FGD212 shows up to three multilevel devices: endpoint 0 (hidden), 1 (the
  // light you see) and 2. The hidden endpoint-0 one carries a `power` property
  // that never moves (corridor wall wash, 14 Nov 2026: 0 W at every level), so
  // prefer the VISIBLE device that meters, then any that meters, then lowest id.
  const ml = devs.filter(d => isMultilevel(d) && Number(d.parentId) > 1).sort((a, b) => a.id - b.id);
  const meters = (d: any) => d.properties?.power !== undefined;
  // Mae Suite main spots: every device hidden, so fall back to endpoint 1 (the
  // load) before the endpoint-0 twin whose power never moves.
  const ep = (d: any) => Number(d.properties?.endPointId ?? 0);
  return ml.find(d => meters(d) && d.visible !== false)
      ?? ml.find(d => meters(d) && ep(d) === 1)
      ?? ml.find(d => meters(d) && ep(d) > 0)
      ?? ml.find(meters) ?? ml[0];
}

/** Read min/max for a node, polling the device for any HC3 has never read. */
async function readMinMax(hc3: any, node: number, p: DimmerProfile): Promise<{ min?: number; max?: number; report?: number; polled: boolean }> {
  const pick = (items: any[], n: number) => num(items.find((i: any) => i.parameterNumber === n)?.configurationValue);
  const wanted = [p.min, p.max, ...(p.report ? [p.report.param] : [])];
  let r = await readNodeParameters(hc3, node, 0);
  let polled = false;
  const blank = wanted.filter(n => Number.isNaN(pick(r.items, n)));
  if (blank.length) {
    polled = true;
    for (const n of blank) {
      await hc3.request(`/api/zwave/polling/configuration_parameters/${encodeURIComponent(r.addr)}/${n}`, 'POST', {}).catch(() => null);
    }
    await sleep(Math.min(settleMs(), 3500));
    r = await readNodeParameters(hc3, node, 0);
  }
  const v = (n: number) => { const x = pick(r.items, n); return Number.isNaN(x) ? undefined : x; };
  return { min: v(p.min), max: v(p.max), report: p.report ? v(p.report.param) : undefined, polled };
}

export async function discoverDimmers(hc3: any): Promise<DimmerEntry[]> {
  const [devices, rooms] = await Promise.all([
    hc3.request('/api/devices?interface=zwave'),
    hc3.request('/api/rooms').catch(() => []),
  ]);
  const roomName = new Map<number, string>((rooms ?? []).map((r: any) => [r.id, r.name]));
  const byNode = new Map<number, any[]>();
  for (const d of devices ?? []) {
    const n = Number(d?.properties?.nodeId);
    if (!Number.isInteger(n) || n < 2) continue;
    if (!byNode.has(n)) byNode.set(n, []);
    byNode.get(n)!.push(d);
  }
  const out: DimmerEntry[] = [];
  for (const [node, devs] of byNode) {
    const light = pickLight(devs);
    if (!light) continue;
    const r = await readNodeParameters(hc3, node, 0);
    const p = profileFor(r.template?.description);
    if (!p) continue;
    const mm = await readMinMax(hc3, node, p);
    out.push({ node, lightId: light.id, rootId: Number(light.parentId), name: light.name,
               room: roomName.get(light.roomID) ?? '?', model: p.key, min: mm.min, max: mm.max,
               report: mm.report, meters: light.properties?.power !== undefined });
  }
  return out.sort((a, b) => (a.room + a.name).localeCompare(b.room + b.name));
}

/** The Dimmer Tuner QuickApp, by id or by name. */
async function findTuner(hc3: any, quickAppId?: number): Promise<any | null> {
  if (quickAppId !== undefined) return await hc3.request(`/api/devices/${quickAppId}`);
  const qas: any[] = await hc3.request('/api/devices?interface=quickApp').catch(() => []);
  const hits = (qas ?? []).filter(d => d?.name === 'Dimmer Tuner');
  if (hits.length > 1) throw new Error(`Several QuickApps are called "Dimmer Tuner" (${hits.map(h => h.id).join(', ')}); pass quickAppId.`);
  // The full record: a list entry need not carry quickAppVariables, and an
  // empty-looking register would drop every tuned minimum on the next write.
  return hits[0] ? await hc3.request(`/api/devices/${hits[0].id}`) : null;
}

function readRegister(qa: any): any[] {
  const v = (qa?.properties?.quickAppVariables ?? []).find((x: any) => x.name === 'dimmers')?.value;
  try { const r = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(r) ? r : []; } catch { return []; }
}

async function writeRegister(hc3: any, qaId: number, entries: any[]): Promise<void> {
  await quickapps.handlers.set_quickapp_variable(hc3, { deviceId: qaId, name: 'dimmers', value: JSON.stringify(entries) });
}

let busy = false;

export const dimmers: ToolModule = {
  schemas: [
    {
      name: 'sync_dimmer_tuner',
      description: "Write the dimmer register into the Dimmer Tuner QuickApp (variable `dimmers`): every supported dimmer on the gateway (Qubino Mini/Flush Dimmer, Fibaro FGD212, Zooz ZEN54) with its node, light device, room, model, and the minimum/maximum level parameters read from HC3 (polling the device for any HC3 has never read). The QuickApp cannot read Z-Wave parameters itself — every /zwave/ route answers 501 from inside a QuickApp — so it relies on this register, and records each low-end value a person saves back into it (tunedMin, tunedAt), which this tool keeps. Writing the variable restarts the QuickApp once; do not run it while someone is mid-way through tuning. Finds the QuickApp by the name \"Dimmer Tuner\" unless quickAppId is given.",
      inputSchema: {
        type: 'object',
        properties: { quickAppId: { type: 'number', description: 'Dimmer Tuner QuickApp id. Default: the QuickApp named "Dimmer Tuner".' } },
      },
    },
    {
      name: 'calibrate_dimmer',
      description: "Tune a dimmer's TOP end by measurement. Steps the light through its levels, reads the power it draws at each, finds where power stops rising (LED lamps often reach full output at 50-60% of the slider, leaving the top half dead), then sets the dimmer's MAXIMUM level parameter so the whole slider is useful while 99% keeps full output — and sweeps again to verify, raising the maximum in steps of 5 until 99% reaches 95% of full power (lamps are warmed for a minute first). Verified by hand on 14 Nov 2026: two kitchen Qubinos plateaued at 55% and 60%; a maximum of 70 fixed both. Optional `deviceCalibration: true` first runs the dimmer's own calibration (Qubino 71=2, FGD212 13=1) and checks its status parameter; an FGD212's calibration OVERWRITES its min and max, so the previous minimum (likely tuned by a person) is written back unless keepMinimum is false.\n\nTHE LIGHTS VISIBLY CHANGE for about 2-3 minutes: ask the user before running it, and say which lights. Restores the light's on/off state and level, and the power-report threshold (lowered to 5% during the sweep so readings are fresh). Needs a dimmer that meters power (not the ZEN54). Does NOT tune the low end: use the Dimmer Tuner QuickApp for that, then re-run this, since the minimum shifts the slider. If a Dimmer Tuner QuickApp exists, its register is updated with the new maximum.",
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: { type: 'number', description: 'The dimmer: its light device or its Z-Wave root device.' },
          deviceCalibration: { type: 'boolean', description: "Run the dimmer's own calibration first. Default false." },
          keepMinimum: { type: 'boolean', description: 'After a calibration that overwrites min/max (FGD212), write the previous minimum back. Default true.' },
          levels: { type: 'array', items: { type: 'number' }, description: 'Sweep levels. Default [20,30,40,50,60,70,80,90,99].' },
        },
        required: ['deviceId'],
      },
    },
    {
      name: 'restore_dimmer_settings',
      description: "Put dimmers' saved MINIMUM and MAXIMUM level parameters (and their power-report threshold) back from a baseline. For a dimmer that was factory-reset, replaced, re-included, or calibrated to something worse. A power cut does NOT need this: Z-Wave dimmers keep parameters in their own memory.\n\nBaselines: `register` (default) is the Dimmer Tuner QuickApp's register, where a person-tuned minimum (tunedMin) wins over the plain min. `snapshot` is zwave-parameters.json in the nightly snapshot repo (`commit`: 'latest', 'before:<ISO date>' or a commit id).\n\nDRY RUN BY DEFAULT: without apply:true it only reads, and returns the plan: for each dimmer, the saved and current values and what would change. With apply:true it writes only the differing values, one dimmer at a time, through set_device_parameter, and reports whether radio frames went out. No lights change level.\n\nA replaced or re-included dimmer gets a NEW node number. Map it with remap {\"<old node>\": <new device id>}; the old node's values and its tuned minimum go to the new one. `devices` limits the run to some dimmers (light or root device ids). A dimmer whose saved model differs from the live one is skipped. After an apply that changed anything, the Dimmer Tuner's register is updated (one QuickApp restart).",
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['register', 'snapshot'], description: "Baseline. Default 'register'." },
          commit: { type: 'string', description: "With source 'snapshot': 'latest' (default), 'before:<ISO date>', or a commit id." },
          devices: { type: 'array', items: { type: 'number' }, description: 'Only these dimmers (light or root device ids). Default: every supported dimmer with a saved value.' },
          remap: { type: 'object', additionalProperties: { type: 'number' }, description: 'Old node number -> new device id, for a replaced or re-included dimmer.' },
          includeReport: { type: 'boolean', description: 'Also restore the power-report threshold. Default true.' },
          apply: { type: 'boolean', description: 'Write the changes. Default false (dry run).' },
        },
      },
    },
  ],

  handlers: {
    async sync_dimmer_tuner(hc3, args: { quickAppId?: number }): Promise<any> {
      const qa = await findTuner(hc3, args?.quickAppId);
      if (!qa) throw new Error('sync_dimmer_tuner: no QuickApp called "Dimmer Tuner" on this HC3. Import quickapps/dimmer-tuner/dimmer-tuner.fqa from the HC3_mcp repo first, or pass quickAppId.');
      const old = new Map<number, any>(readRegister(qa).map((e: any) => [Number(e.node), e]));
      const found = await discoverDimmers(hc3);
      const entries = found.map(e => {
        const prev = old.get(e.node);
        return { ...e, ...(prev?.tunedMin !== undefined ? { tunedMin: prev.tunedMin, tunedAt: prev.tunedAt } : {}) };
      });
      await writeRegister(hc3, qa.id, entries);
      const unread = entries.filter(e => e.min === undefined || e.max === undefined).map(e => `${e.name} (node ${e.node})`);
      return {
        quickAppId: qa.id,
        dimmers: entries.length,
        byModel: entries.reduce((m: any, e) => ((m[e.model] = (m[e.model] ?? 0) + 1), m), {}),
        keptTunings: entries.filter(e => (e as any).tunedMin !== undefined).length,
        ...(unread.length ? { minMaxUnknown: unread, note: 'These did not answer a parameter poll; the QuickApp will not tune them until a later sync reads them.' } : {}),
        entries: entries.map(e => ({ node: e.node, light: e.lightId, name: e.name, room: e.room, model: e.model, min: e.min, max: e.max })),
      };
    },

    async calibrate_dimmer(hc3, args: { deviceId: number; deviceCalibration?: boolean; keepMinimum?: boolean; levels?: any }): Promise<any> {
      if (busy) throw new Error('calibrate_dimmer: another calibration is running. One at a time: the sweeps read the mesh.');
      const id = Number(args?.deviceId);
      if (!Number.isInteger(id) || id < 10) throw new Error('calibrate_dimmer: deviceId must be a device id >= 10.');
      let levels: number[] = [20, 30, 40, 50, 60, 70, 80, 90, 99];
      if (args.levels !== undefined) {
        let l = args.levels;
        if (typeof l === 'string') { try { l = JSON.parse(l); } catch { /* refused below */ } }
        if (!Array.isArray(l) || l.length < 3 || l.some((x: any) => !Number.isInteger(x) || x < 1 || x > 99)) {
          throw new Error('calibrate_dimmer: levels must be at least 3 integers between 1 and 99.');
        }
        levels = [...new Set<number>(l)].sort((a, b) => a - b);
        if (!levels.includes(99)) levels.push(99);
      }

      const dev = await hc3.request(`/api/devices/${id}`);
      const node = Number(dev?.properties?.nodeId);
      if (!Number.isInteger(node)) throw new Error(`calibrate_dimmer: device ${id} (${dev?.name}) is not a Z-Wave device.`);
      const all: any[] = await hc3.request('/api/devices?interface=zwave');
      const light = pickLight(all.filter(d => Number(d?.properties?.nodeId) === node));
      if (!light) throw new Error(`calibrate_dimmer: node ${node} has no dimmable light device.`);
      const rootId = Number(light.parentId);
      const tpl = (await readNodeParameters(hc3, node, 0)).template;
      const p = profileFor(tpl?.description);
      if (!p) throw new Error(`calibrate_dimmer: node ${node} is a "${tpl?.description ?? 'unknown'}", not a supported dimmer (${DIMMER_PROFILES.map(x => x.label).join(', ')}).`);
      const meters = light.properties?.power !== undefined;
      if (!meters && !args.deviceCalibration) {
        throw new Error(`calibrate_dimmer: ${light.name} (${p.label}) does not meter power, so its top end cannot be measured. Only deviceCalibration is possible on it, and the low end is tuned by eye with the Dimmer Tuner QuickApp.`);
      }

      busy = true;
      const writes: any[] = [];
      // A write that sends no radio frames did not reach the dimmer (den wall
      // wash, 14 Nov 2026: the 2% threshold and the opened maximum both stayed
      // home, the sweep measured the OLD maximum, and the result claimed 99).
      // Stop rather than measure something else. Restores are best-effort.
      let restoring = false;
      const setParam = async (param: number, size: number, value: number, why: string) => {
        if (param === p.max) maxTouched = true;
        const r = await zwave.handlers.set_device_parameter(hc3, { deviceId: rootId, parameterNumber: param, size, value });
        writes.push({ param, value, why, transmitted: r.transmitted, cacheNow: r.after?.value ?? null });
        if (r.transmitted === false && !restoring) {
          throw new Error(`calibrate_dimmer: writing parameter ${param} = ${value} (${why}) sent no radio frames to node ${node}, so it did not reach the dimmer. ` +
            'Stopped and put things back; the dimmer may have a weak link (see get_zwave_node_diagnostics). Try again later.');
        }
        return r;
      };
      const setLevel = (v: number) => hc3.request(`/api/devices/${light.id}/action/setValue`, 'POST', { args: [v] });
      const powerNow = async () => num((await hc3.request(`/api/devices/${light.id}`))?.properties?.power);
      // Live run, 14 Nov 2026: a busy node confirmed levels several at once,
      // seconds late, and power arrives in two reports (ramp, then settled) up
      // to ~5 s after the level. So: wait for the dimmer to CONFIRM the level,
      // then settle, then read until two readings 2 s apart agree.
      const levelNow = async () => num((await hc3.request(`/api/devices/${light.id}`))?.properties?.value);
      const measure = async (level: number): Promise<number> => {
        await setLevel(level);
        const waitUntil = Date.now() + 15 * Math.min(1000, settleMs());
        while (Date.now() < waitUntil && (await levelNow()) !== level) await sleep(Math.min(500, settleMs()));
        await sleep(settleMs());
        let last = await powerNow();
        for (let i = 0; i < 3; i++) {
          await sleep(Math.min(2000, settleMs()));
          const again = await powerNow();
          if (again === last) break;
          last = again;
        }
        return last;
      };
      // Power must not FALL as the level rises. A step that does is re-measured
      // once; one that still does marks the sweep unreliable.
      const sweep = async (ls: number[]) => {
        const out: [number, number][] = [];
        for (const l of ls) out.push([l, await measure(l)]);
        const bad = () => out.findIndex(([, w], i) => i > 0 && w < out[i - 1][1] * 0.93);
        for (let tries = 0, i = bad(); i > 0 && tries < 3; tries++, i = bad()) out[i] = [out[i][0], await measure(out[i][0])];
        // Stuck readings: guest left bed light, 14 Nov 2026, read 4.7 W at every
        // level from 20% to 99% (no report after the warm-up), so the plateau
        // was "20%" and the maximum went to 40. Fewer than 3 distinct readings
        // across a sweep means power is not being reported, not that it is flat.
        const distinct = new Set(out.map(([, w]) => w)).size;
        return { out, reliable: bad() < 0 && distinct >= 3 };
      };

      const lp = light.properties ?? {};
      const orig = { value: num(lp.value) || 0, on: lp.state === true || lp.state === 'true' || (num(lp.value) || 0) > 0 };
      const before = await readMinMax(hc3, node, p);
      const result: any = { light: { id: light.id, name: light.name }, rootId, node, model: p.label, before: { min: before.min, max: before.max } };
      let reportChanged = false;
      let maxTouched = false;   // a sweep opened or changed the maximum
      let completed = false;    // the run reached a result that set the maximum on purpose

      try {
        // 1. The dimmer's own calibration.
        if (args.deviceCalibration) {
          if (!p.calibrate) {
            result.deviceCalibration = { skipped: `${p.label} has no calibration parameter.` };
          } else {
            await setParam(p.calibrate.param, 1, p.calibrate.value, 'device calibration');
            await sleep(Math.max(settleMs(), 5000) * (p.calibrate.overwritesMinMax ? 2 : 1));
            if (p.calibrate.overwritesMinMax) {
              // An FGD212 calibrates for far longer than 10 s and answers nothing
              // meanwhile: the next write sat in HC3's queue and read as "no
              // frames" on three bedrooms' dimmers (14 Nov 2026). Parameter 13
              // reads 1 while it works and returns to 0 when done; wait for that.
              const addr = (await readNodeParameters(hc3, node, 0)).addr;
              const until = Date.now() + 180 * Math.min(1000, settleMs());
              let calibrating: boolean;
              do {   // always check at least once
                await hc3.request(`/api/zwave/polling/configuration_parameters/${encodeURIComponent(addr)}/${p.calibrate.param}`, 'POST', {}).catch(() => null);
                await sleep(Math.min(5000, settleMs()));
                const v = num((await readNodeParameters(hc3, node, 0)).items.find((i: any) => i.parameterNumber === p.calibrate!.param)?.configurationValue);
                calibrating = v !== 0;
              } while (calibrating && Date.now() < until);
              if (calibrating) throw new Error(`calibrate_dimmer: ${light.name} was still calibrating itself after 3 minutes (parameter ${p.calibrate.param} not back to 0). Try again later.`);
            }
            const r = await readNodeParameters(hc3, node, 0);
            await hc3.request(`/api/zwave/polling/configuration_parameters/${encodeURIComponent(r.addr)}/${p.calibrate.status}`, 'POST', {}).catch(() => null);
            const after = await readMinMax(hc3, node, p);
            await sleep(Math.min(settleMs(), 3500));
            const st = num((await readNodeParameters(hc3, node, 0)).items.find((i: any) => i.parameterNumber === p.calibrate!.status)?.configurationValue);
            result.deviceCalibration = { status: Number.isNaN(st) ? null : st, succeeded: st === p.calibrate.ok, minAfter: after.min, maxAfter: after.max };
            if (p.calibrate.overwritesMinMax && st !== p.calibrate.ok) {
              // A failed calibration (FGD212 status 0 = "manual settings") still
              // rewrote min and max: put both back rather than keep its guesses.
              if (before.min !== undefined && after.min !== before.min) await setParam(p.min, p.size, before.min, 'calibration failed: restore minimum');
              if (before.max !== undefined && after.max !== before.max) await setParam(p.max, p.size, before.max, 'calibration failed: restore maximum');
              result.deviceCalibration.restoredAfterFailure = { min: before.min, max: before.max };
            } else if (p.calibrate.overwritesMinMax && args.keepMinimum !== false && before.min !== undefined && after.min !== before.min) {
              await setParam(p.min, p.size, before.min, 'restore the minimum the calibration overwrote');
              result.deviceCalibration.minimumRestored = before.min;
            }
          }
          if (!meters) { completed = true; result.note = 'Device calibration only: this dimmer does not meter power.'; result.writes = writes; return result; }
        }

        // 2. Fresh power readings for the sweep.
        // 2% not 5%: with 5% a lamp that brightens gradually reads as flat stretches and jumps.
        if (p.report && before.report !== 2) { await setParam(p.report.param, p.report.size, 2, 'power reports every 2% change, for the sweep'); reportChanged = true; }

        // 3. Sweep with the maximum wide open.
        if (before.max !== p.maxHi) await setParam(p.max, p.size, p.maxHi, 'open the maximum for the sweep');
        // Warm the lamps first. Guest ensuite, 14 Nov 2026: cold lamps peaked at
        // 24.5 W, the same lamps eight minutes later at 22.9 W (-6%), so the
        // verify sweeps never "reached full power" and the maximum was raised
        // back to 99 for nothing.
        await setLevel(99);
        await sleep(10 * settleMs());
        const openRun = await sweep(levels);
        const open = openRun.out;
        const full = Math.max(...open.map(([, w]) => w));
        result.sweepOpen = open;
        if (!(full >= 1)) throw new Error(`calibrate_dimmer: the light drew no measurable power (max ${full} W). Is the load connected, or its power reporting off?`);
        if (!openRun.reliable) {
          if (before.max !== undefined && before.max !== p.maxHi) await setParam(p.max, p.size, before.max, 'unreliable readings: put the maximum back');
          result.chosenMax = before.max ?? p.maxHi;
          result.reliable = false;
          result.summary = `Readings did not make sense (power fell as the level rose, or barely changed at all, even when re-measured): maximum left at ${result.chosenMax}. Small lamps (a few watts) may report too coarsely to measure; tune those by eye.`;
          completed = true;
          result.writes = writes;
          return result;
        }
        const plateau = open.find(([, w]) => w >= REACH * full)![0];
        result.fullPowerW = full;
        result.plateauAtLevel = plateau;

        // 4. Choose the maximum, verifying that 99% still reaches full power.
        let chosen = p.maxHi;
        let verify: [number, number][] = open;
        if (plateau < 85) {
          chosen = Math.max(p.maxLo, Math.min(p.maxHi, plateau + 10));
          for (let i = 0; i < 6; i++) {
            await setParam(p.max, p.size, chosen, i === 0 ? 'maximum just above the plateau' : 'raise: 99% fell short of full power');
            verify = (await sweep(levels)).out;
            const top = verify[verify.length - 1][1];
            if (top >= REACH * full || chosen >= p.maxHi) break;
            chosen = Math.min(p.maxHi, chosen + 5);
          }
        }
        result.chosenMax = chosen;
        result.sweepFinal = verify;
        result.reliable = true;
        result.summary = plateau >= 85
          ? `Power rises right up to ${plateau}%: no headroom to reclaim. Maximum left at ${p.maxHi}.`
          : `Power stopped rising at ${plateau}% of the slider (${full} W). Maximum set to ${chosen} (was ${before.max ?? 'unknown'}); 99% now draws ${verify[verify.length - 1][1]} W.`;

        // 5. Keep the Dimmer Tuner's register in step.
        try {
          const qa = await findTuner(hc3);
          if (qa) {
            const reg = readRegister(qa);
            const e = reg.find((x: any) => Number(x.node) === node);
            if (e && e.max !== chosen) {
              e.max = chosen; e.maxCalibratedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
              await writeRegister(hc3, qa.id, reg);
              result.quickAppId = qa.id;   // for the write log: the register variable changed
            }
          }
        } catch (e: any) { result.tunerRegisterError = String(e?.message ?? e); }
        completed = true;
        result.writes = writes;   // the same object the finally block adds `restored` to
        return result;
      } finally {
        try {
          // Never read before (a blank HC3 never polled): fall back to the maker's default, 10%.
          restoring = true;
          if (reportChanged) await setParam(p.report!.param, p.report!.size, before.report ?? 10, 'restore power-report threshold');
          // Stopped by an error after the sweep opened the maximum: put it back.
          if (!completed && maxTouched && before.max !== undefined) await setParam(p.max, p.size, before.max, 'run stopped: restore maximum');
          if (orig.on) await setLevel(orig.value || 99); else await hc3.request(`/api/devices/${light.id}/action/turnOff`, 'POST', {});
          result.restored = { light: orig.on ? orig.value : 'off', reportThreshold: reportChanged ? (before.report ?? 10) : 'unchanged',
                              ...(!completed && maxTouched ? { max: before.max } : {}) };
        } finally { busy = false; }
      }
    },

    async restore_dimmer_settings(hc3, args: { source?: string; commit?: string; devices?: any; remap?: any; includeReport?: boolean; apply?: boolean }): Promise<any> {
      const source = args?.source ?? 'register';
      if (source !== 'register' && source !== 'snapshot') throw new Error("restore_dimmer_settings: source must be 'register' or 'snapshot'.");
      const parse = (v: any) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; };
      const devicesArg = parse(args?.devices);
      if (devicesArg !== undefined && (!Array.isArray(devicesArg) || devicesArg.some((x: any) => !Number.isInteger(Number(x))))) {
        throw new Error('restore_dimmer_settings: devices must be a list of device ids.');
      }
      const remapArg = parse(args?.remap) ?? {};
      if (typeof remapArg !== 'object' || Array.isArray(remapArg)) throw new Error('restore_dimmer_settings: remap must be {"<old node>": <new device id>}.');
      const includeReport = args?.includeReport !== false;
      const apply = args?.apply === true;
      if (apply && busy) throw new Error('restore_dimmer_settings: a calibration or restore is running. One at a time.');

      const nodeOf = async (id: number) => {
        const n = Number((await hc3.request(`/api/devices/${id}`))?.properties?.nodeId);
        if (!Number.isInteger(n)) throw new Error(`restore_dimmer_settings: device ${id} is not a Z-Wave device.`);
        return n;
      };
      // new node -> old node
      const remap = new Map<number, number>();
      for (const [oldNode, devId] of Object.entries(remapArg)) {
        const o = Number(oldNode);
        if (!Number.isInteger(o) || !Number.isInteger(Number(devId))) throw new Error(`restore_dimmer_settings: bad remap entry ${oldNode} -> ${devId}.`);
        remap.set(await nodeOf(Number(devId)), o);
      }

      // The baseline, keyed by (old) node.
      const qa = await findTuner(hc3).catch(() => null);
      const reg = qa ? readRegister(qa) : [];
      const regByNode = new Map<number, any>(reg.map((e: any) => [Number(e.node), e]));
      let baseline: any = { source };
      const saved = new Map<number, { name?: string; model?: string; vals: (p: DimmerProfile) => { min?: number; max?: number; report?: number } }>();
      if (source === 'register') {
        if (!qa) throw new Error('restore_dimmer_settings: no Dimmer Tuner QuickApp, so no register. Use source "snapshot".');
        baseline.quickAppId = qa.id;
        for (const e of reg) {
          saved.set(Number(e.node), { name: e.name, model: e.model, vals: () => ({ min: num(e.tunedMin ?? e.min), max: num(e.max), report: num(e.report) }) });
        }
      } else {
        const s = await readSnapshotJson(args?.commit, 'zwave-parameters.json');
        baseline = { source, commit: s.commit.slice(0, 12), date: s.date };
        for (const e of Object.values<any>(s.json ?? {})) {
          const n = Number(e?.nodeId);
          if (!Number.isInteger(n) || (saved.has(n) && Number(e.endPointId) !== 0)) continue;
          const items: any[] = e?.parameters?.items ?? [];
          const at = (k: number) => num(items.find((i: any) => i.parameterNumber === k)?.configurationValue);
          // The snapshot does not record the model; the register does, where it has the node.
          saved.set(n, { name: e.name, model: regByNode.get(n)?.model, vals: p => ({ min: at(p.min), max: at(p.max), report: p.report ? at(p.report.param) : undefined }) });
        }
      }

      let targets = await discoverDimmers(hc3);
      if (devicesArg !== undefined) {
        const want = new Set<number>();
        for (const id of devicesArg) want.add(await nodeOf(Number(id)));
        targets = targets.filter(t => want.has(t.node));
        const missing = [...want].filter(n => !targets.some(t => t.node === n));
        if (missing.length) throw new Error(`restore_dimmer_settings: node(s) ${missing.join(', ')} are not supported dimmers.`);
      }
      for (const n of remap.keys()) {
        if (!targets.some(t => t.node === n)) throw new Error(`restore_dimmer_settings: remap target node ${n} is not a supported dimmer${devicesArg ? ' in devices' : ''}.`);
      }

      const ok = (v: any) => Number.isFinite(v);
      const plan: any[] = [];
      for (const t of targets) {
        const p = DIMMER_PROFILES.find(x => x.key === t.model)!;
        const from = remap.get(t.node) ?? t.node;
        const s = saved.get(from);
        const row: any = { node: t.node, ...(from !== t.node ? { fromNode: from } : {}), name: t.name, room: t.room, model: t.model,
                           current: { min: t.min, max: t.max, ...(p.report ? { report: t.report } : {}) } };
        plan.push(row);
        if (!s) { row.skipped = `no saved values for node ${from} in the ${source}`; continue; }
        if (s.model && s.model !== t.model) { row.skipped = `saved as a ${s.model}, now a ${t.model}: parameters differ`; continue; }
        const v = s.vals(p);
        row.saved = { min: ok(v.min) ? v.min : null, max: ok(v.max) ? v.max : null, ...(p.report ? { report: ok(v.report) ? v.report : null } : {}) };
        const bad: string[] = [];
        if (ok(v.min) && (v.min! < p.minLo || v.min! > p.minHi)) bad.push(`min ${v.min} outside ${p.minLo}-${p.minHi}`);
        if (ok(v.max) && (v.max! < p.maxLo || v.max! > p.maxHi)) bad.push(`max ${v.max} outside ${p.maxLo}-${p.maxHi}`);
        if (ok(v.min) && ok(v.max) && v.min! >= v.max!) bad.push(`min ${v.min} not below max ${v.max}`);
        if (ok(v.report) && (v.report! < 0 || v.report! > 100)) bad.push(`report ${v.report} outside 0-100`);
        if (bad.length) { row.skipped = `saved values refused: ${bad.join('; ')}`; continue; }
        const ch: any[] = [];
        if (ok(v.max) && v.max !== t.max) ch.push({ what: 'max', param: p.max, size: p.size, from: t.max ?? null, to: v.max });
        if (ok(v.min) && v.min !== t.min) ch.push({ what: 'min', param: p.min, size: p.size, from: t.min ?? null, to: v.min });
        // Max first, unless the new max sits below the current min.
        if (ch.length === 2 && ok(t.min) && v.max! <= t.min!) ch.reverse();
        if (includeReport && p.report && ok(v.report) && v.report !== t.report) ch.push({ what: 'report', param: p.report.param, size: p.report.size, from: t.report ?? null, to: v.report });
        row.changes = ch;
        (row as any)._t = t;
      }

      const summary = {
        dimmers: plan.length,
        toChange: plan.filter(r => r.changes?.length).length,
        alreadyMatch: plan.filter(r => r.changes && !r.changes.length).length,
        skipped: plan.filter(r => r.skipped).length,
      };
      const clean = () => plan.map(r => { const { _t, ...rest } = r; return rest; });
      if (!apply) {
        return { baseline, dryRun: true, ...summary, plan: clean(),
                 note: summary.toChange ? 'Nothing written. Run again with apply:true to write the changes.' : 'Every dimmer already matches the baseline.' };
      }

      busy = true;
      const result: any = { baseline, applied: true, ...summary };
      try {
        for (const r of plan) {
          if (!r.changes?.length) continue;
          const t: DimmerEntry = r._t;
          for (const c of r.changes) {
            try {
              const w = await zwave.handlers.set_device_parameter(hc3, { deviceId: t.rootId, parameterNumber: c.param, size: c.size, value: c.to });
              c.transmitted = w.transmitted; c.cacheNow = w.after?.value ?? null;
              c.ok = w.transmitted !== false && (c.cacheNow === null || c.cacheNow === c.to);
            } catch (e: any) { c.ok = false; c.error = String(e?.message ?? e); }
            if (!c.ok) { r.failed = `${c.what} did not take${c.transmitted === false ? ' (no radio frames: weak link or asleep)' : ''}; stopped on this dimmer`; break; }
          }
        }
        result.failed = plan.filter(r => r.failed).length;

        // Keep the Dimmer Tuner's register in step with what is now on the dimmers.
        const changed = plan.filter(r => r.changes?.some((c: any) => c.ok));
        if (qa && (changed.length || remap.size)) {
          try {
            const fresh = new Map<number, any>(readRegister(await findTuner(hc3, qa.id)).map((e: any) => [Number(e.node), e]));
            for (const r of plan) {
              if (!r._t || (!r.changes?.some((c: any) => c.ok) && r.fromNode === undefined)) continue;
              const t: DimmerEntry = r._t;
              const e = fresh.get(t.node) ?? { ...t };
              for (const c of r.changes ?? []) if (c.ok) e[c.what] = c.to;
              if (r.fromNode !== undefined) {
                const old = fresh.get(r.fromNode) ?? regByNode.get(r.fromNode);
                if (old?.tunedMin !== undefined) { e.tunedMin = old.tunedMin; e.tunedAt = old.tunedAt; }
                if (!targets.some(x => x.node === r.fromNode)) fresh.delete(r.fromNode);
              }
              fresh.set(t.node, e);
            }
            await writeRegister(hc3, qa.id, [...fresh.values()].sort((a: any, b: any) => (a.room + a.name).localeCompare(b.room + b.name)));
            result.quickAppId = qa.id;   // for the write log
          } catch (e: any) { result.tunerRegisterError = String(e?.message ?? e); }
        }
        result.plan = clean();
        return result;
      } finally { busy = false; }
    },
  },
};
