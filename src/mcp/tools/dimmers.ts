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

export interface DimmerEntry {
  node: number; lightId: number; rootId: number; name: string; room: string;
  model: string; min?: number; max?: number;
}

/** The light of a node: its multilevel child, preferring one that meters power. */
function pickLight(devs: any[]): any | undefined {
  const ml = devs.filter(d => isMultilevel(d) && Number(d.parentId) > 1);
  return ml.find(d => d.properties?.power !== undefined) ?? ml.sort((a, b) => a.id - b.id)[0];
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
               room: roomName.get(light.roomID) ?? '?', model: p.key, min: mm.min, max: mm.max });
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
      description: "Tune a dimmer's TOP end by measurement. Steps the light through its levels, reads the power it draws at each, finds where power stops rising (LED lamps often reach full output at 50-60% of the slider, leaving the top half dead), then sets the dimmer's MAXIMUM level parameter so the whole slider is useful while 99% keeps full output — and sweeps again to verify, raising the maximum in steps of 5 until 99% reaches 97% of full power. Verified by hand on 14 Nov 2026: two kitchen Qubinos plateaued at 55% and 60%; a maximum of 70 fixed both. Optional `deviceCalibration: true` first runs the dimmer's own calibration (Qubino 71=2, FGD212 13=1) and checks its status parameter; an FGD212's calibration OVERWRITES its min and max, so the previous minimum (likely tuned by a person) is written back unless keepMinimum is false.\n\nTHE LIGHTS VISIBLY CHANGE for about 2-3 minutes: ask the user before running it, and say which lights. Restores the light's on/off state and level, and the power-report threshold (lowered to 5% during the sweep so readings are fresh). Needs a dimmer that meters power (not the ZEN54). Does NOT tune the low end: use the Dimmer Tuner QuickApp for that, then re-run this, since the minimum shifts the slider. If a Dimmer Tuner QuickApp exists, its register is updated with the new maximum.",
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
      const setParam = async (param: number, size: number, value: number, why: string) => {
        const r = await zwave.handlers.set_device_parameter(hc3, { deviceId: rootId, parameterNumber: param, size, value });
        writes.push({ param, value, why, transmitted: r.transmitted, cacheNow: r.after?.value ?? null });
        return r;
      };
      const setLevel = (v: number) => hc3.request(`/api/devices/${light.id}/action/setValue`, 'POST', { args: [v] });
      const powerNow = async () => num((await hc3.request(`/api/devices/${light.id}`))?.properties?.power);
      const measure = async (level: number): Promise<number> => {
        await setLevel(level);
        await sleep(settleMs());
        let last = await powerNow();
        for (let i = 0; i < 2; i++) {
          await sleep(Math.min(2000, settleMs()));
          const again = await powerNow();
          if (again === last) break;
          last = again;
        }
        return last;
      };
      const sweep = async (ls: number[]) => { const out: [number, number][] = []; for (const l of ls) out.push([l, await measure(l)]); return out; };

      const lp = light.properties ?? {};
      const orig = { value: num(lp.value) || 0, on: lp.state === true || lp.state === 'true' || (num(lp.value) || 0) > 0 };
      const before = await readMinMax(hc3, node, p);
      const result: any = { light: { id: light.id, name: light.name }, rootId, node, model: p.label, before: { min: before.min, max: before.max } };
      let reportChanged = false;

      try {
        // 1. The dimmer's own calibration.
        if (args.deviceCalibration) {
          if (!p.calibrate) {
            result.deviceCalibration = { skipped: `${p.label} has no calibration parameter.` };
          } else {
            await setParam(p.calibrate.param, 1, p.calibrate.value, 'device calibration');
            await sleep(Math.max(settleMs(), 5000) * (p.calibrate.overwritesMinMax ? 2 : 1));
            const r = await readNodeParameters(hc3, node, 0);
            await hc3.request(`/api/zwave/polling/configuration_parameters/${encodeURIComponent(r.addr)}/${p.calibrate.status}`, 'POST', {}).catch(() => null);
            const after = await readMinMax(hc3, node, p);
            await sleep(Math.min(settleMs(), 3500));
            const st = num((await readNodeParameters(hc3, node, 0)).items.find((i: any) => i.parameterNumber === p.calibrate!.status)?.configurationValue);
            result.deviceCalibration = { status: Number.isNaN(st) ? null : st, succeeded: st === p.calibrate.ok, minAfter: after.min, maxAfter: after.max };
            if (p.calibrate.overwritesMinMax && args.keepMinimum !== false && before.min !== undefined && after.min !== before.min) {
              await setParam(p.min, p.size, before.min, 'restore the minimum the calibration overwrote');
              result.deviceCalibration.minimumRestored = before.min;
            }
          }
          if (!meters) { result.note = 'Device calibration only: this dimmer does not meter power.'; result.writes = writes; return result; }
        }

        // 2. Fresh power readings for the sweep.
        if (p.report && before.report !== 5) { await setParam(p.report.param, p.report.size, 5, 'power reports every 5% change, for the sweep'); reportChanged = true; }

        // 3. Sweep with the maximum wide open.
        if (before.max !== p.maxHi) await setParam(p.max, p.size, p.maxHi, 'open the maximum for the sweep');
        const open = await sweep(levels);
        const full = Math.max(...open.map(([, w]) => w));
        result.sweepOpen = open;
        if (!(full >= 1)) throw new Error(`calibrate_dimmer: the light drew no measurable power (max ${full} W). Is the load connected, or its power reporting off?`);
        const plateau = open.find(([, w]) => w >= 0.97 * full)![0];
        result.fullPowerW = full;
        result.plateauAtLevel = plateau;

        // 4. Choose the maximum, verifying that 99% still reaches full power.
        let chosen = p.maxHi;
        let verify: [number, number][] = open;
        if (plateau < 90) {
          chosen = Math.max(p.maxLo, Math.min(p.maxHi, plateau + 10));
          for (let i = 0; i < 6; i++) {
            await setParam(p.max, p.size, chosen, i === 0 ? 'maximum just above the plateau' : 'raise: 99% fell short of full power');
            verify = await sweep(levels);
            const top = verify[verify.length - 1][1];
            if (top >= 0.97 * full || chosen >= p.maxHi) break;
            chosen = Math.min(p.maxHi, chosen + 5);
          }
        }
        result.chosenMax = chosen;
        result.sweepFinal = verify;
        result.summary = plateau >= 90
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
        result.writes = writes;   // the same object the finally block adds `restored` to
        return result;
      } finally {
        try {
          // Never read before (a blank HC3 never polled): fall back to the maker's default, 10%.
          if (reportChanged) await setParam(p.report!.param, p.report!.size, before.report ?? 10, 'restore power-report threshold');
          if (orig.on) await setLevel(orig.value || 99); else await hc3.request(`/api/devices/${light.id}/action/turnOff`, 'POST', {});
          result.restored = { light: orig.on ? orig.value : 'off', reportThreshold: reportChanged ? (before.report ?? 10) : 'unchanged' };
        } finally { busy = false; }
      }
    },
  },
};
