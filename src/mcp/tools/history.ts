// Temperature history: the series behind the HC3 web UI's temperature graphs.
//
// No documented route serves it (/api/panels/history and
// /api/history/temperature/{id} answer 501), but the UI's own graph call does:
// GET /api/temperature/{fromEpoch}/{toEpoch}/summary-graph/devices/temperature/{id}
// returns [[epochMs, value], ...], one point per change. Reported 31 Oct 2026,
// confirmed 14 Nov 2026 (sensor 3704: 581 points over 30 days; QuickApp
// temperature device 4645: 1622). A QuickApp device needs saveLogs on.

import { ToolModule } from './registry';
import { isNotFound } from '../hc3-client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// QuickApp log archive: the long view of every eventlog.lua log, collected on
// the Pi by scripts/log-archive-pi.mjs (one file per QuickApp per day under
// HC3_LOG_ARCHIVE_DIR). The gateway keeps only a short buffer since the
// reboots of 13-18 Nov 2026, so anything older than a few days is only here.
const ARCHIVE_DIR = () => process.env.HC3_LOG_ARCHIVE_DIR ?? '/var/lib/hc3-mcp/logs';
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

function readJsonFile(path: string): any {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** YYYY-MM-DD from a date string or epoch seconds; undefined passes through. */
function toDate(v: any, name: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e9) {
    const d = new Date(n * 1000);
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  throw new Error(`get_log_archive: ${name} must be YYYY-MM-DD or epoch seconds, got ${JSON.stringify(v)}.`);
}

export const history: ToolModule = {
  schemas: [
    {
      name: 'get_temperature_history',
      description: "Temperature readings for one device over a time window, from the series behind the HC3 web UI's temperature graphs: one point per change, as [epochSeconds, value]. Works for Z-Wave temperature sensors and for QuickApp temperature devices with saveLogs on. Defaults to the last 24 hours. Long windows are thinned evenly to maxPoints (default 500), always keeping the first and last point; `returned` and `total` say how many. An empty series means no readings were logged in the window (or saveLogs is off), not that the device is missing.",
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: { type: 'number', description: 'Temperature device id.' },
          from: { type: 'number', description: 'Window start, epoch seconds. Default: 24 h before `to`.' },
          to: { type: 'number', description: 'Window end, epoch seconds. Default: now.' },
          maxPoints: { type: 'number', description: 'Thin the series to at most this many points. Default 500, max 5000.' },
        },
        required: ['deviceId'],
      },
    },
    {
      name: 'get_log_archive',
      description: "The long view of the QuickApps' own event logs (eventlog.lua), kept on the Pi for two years by the log-archive timer. The HC3 itself keeps only a few days, so for anything older this is the only record. With no `qa`, lists what is archived: each QuickApp's id, name, first and last day and day count. With `qa` (a QuickApp id, or part of its name), returns its events as [epochSeconds, kind, data], filtered by date range (`from`/`to`, YYYY-MM-DD or epoch seconds, default the last 7 days), `kind` (e.g. \"W\", \"E\", \"start\", \"snap\", or a list) and `contains` (case-insensitive text match on the event's data). Newest first by default; `limit` caps the result (default 200, max 5000) and `total` says how many matched. `dropped` per day counts events the QuickApp discarded for size before the Pi read them. Only works on the machine running the archive timer (the Pi): elsewhere it says the archive is absent rather than returning nothing.",
      inputSchema: {
        type: 'object',
        properties: {
          qa: { description: 'QuickApp id (number) or part of its name (string). Omit to list the archive.' },
          from: { description: 'First day, YYYY-MM-DD or epoch seconds. Default: 7 days before `to`.' },
          to: { description: 'Last day, YYYY-MM-DD or epoch seconds. Default: today.' },
          kind: { description: 'Event kind or list of kinds to keep (e.g. "W", ["W","E"]). Default: all.' },
          contains: { type: 'string', description: 'Keep only events whose data contains this text (case-insensitive).' },
          limit: { type: 'number', description: 'Maximum events to return. Default 200, max 5000.' },
          order: { type: 'string', enum: ['newest', 'oldest'], description: 'Default newest first.' },
        },
      },
    },
  ],
  handlers: {
    async get_log_archive(_hc3, args: { qa?: number | string; from?: any; to?: any; kind?: string | string[]; contains?: string; limit?: number; order?: string }): Promise<any> {
      const dir = ARCHIVE_DIR();
      let qaDirs: string[];
      try { qaDirs = readdirSync(dir).filter(d => /^\d+$/.test(d) && statSync(join(dir, d)).isDirectory()); } catch {
        return {
          archive: dir, present: false,
          note: 'No log archive here. It is written on the Pi by the hc3-log-archive timer (scripts/log-archive-pi.mjs, see DEPLOYMENT.md). This server instance is probably not the Pi, or the timer is not installed yet.',
        };
      }
      const index = readJsonFile(join(dir, 'index.json')) ?? { qas: {} };
      const entries = qaDirs.map(d => {
        const days = readdirSync(join(dir, d)).filter(f => DAY_FILE.test(f)).sort();
        const info = index.qas?.[d] ?? {};
        return { qaId: Number(d), qaName: info.qaName, firstDate: days[0]?.slice(0, 10), lastDate: days[days.length - 1]?.slice(0, 10), days: days.length, files: days };
      }).sort((a, b) => a.qaId - b.qaId);

      if (args.qa === undefined || args.qa === null || args.qa === '') {
        return {
          archive: dir, present: true, updatedAt: index.updatedAt, retainDays: index.retainDays,
          quickApps: entries.map(({ files, ...rest }) => rest),
        };
      }

      const want = String(args.qa).trim();
      let match = entries.filter(e => String(e.qaId) === want);
      if (match.length === 0) match = entries.filter(e => (e.qaName ?? '').toLowerCase().includes(want.toLowerCase()));
      if (match.length === 0) throw new Error(`get_log_archive: no archived QuickApp matches ${JSON.stringify(args.qa)}. Call it with no qa to list what is archived.`);
      if (match.length > 1) throw new Error(`get_log_archive: ${JSON.stringify(args.qa)} matches ${match.map(m => `${m.qaId} (${m.qaName})`).join(', ')}. Pass the id.`);
      const qa = match[0];

      const to = toDate(args.to, 'to') ?? toDate(Math.floor(Date.now() / 1000), 'to')!;
      const from = toDate(args.from, 'from') ?? (() => {
        const [y, m, d] = to.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d) - 7 * 86400000).toISOString().slice(0, 10);
      })();
      if (from > to) throw new Error(`get_log_archive: from (${from}) is after to (${to}).`);

      const kinds = args.kind === undefined ? null : new Set((Array.isArray(args.kind) ? args.kind : [args.kind]).map(String));
      const needle = args.contains ? String(args.contains).toLowerCase() : null;
      const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 5000);
      const newestFirst = args.order !== 'oldest';

      const matched: any[] = [];
      const days: Array<{ date: string; events: number; dropped: number }> = [];
      for (const f of qa.files) {
        const date = f.slice(0, 10);
        if (date < from || date > to) continue;
        const doc = readJsonFile(join(dir, String(qa.qaId), f));
        if (!doc || !Array.isArray(doc.ev)) continue;
        days.push({ date, events: doc.ev.length, dropped: Number(doc.dropped) || 0 });
        for (const e of doc.ev) {
          if (kinds && !kinds.has(String(e[1]))) continue;
          if (needle) {
            const text = typeof e[2] === 'string' ? e[2] : JSON.stringify(e[2] ?? '');
            if (!text.toLowerCase().includes(needle)) continue;
          }
          matched.push(e);
        }
      }
      matched.sort((a, b) => newestFirst ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]));
      return {
        qaId: qa.qaId, qaName: qa.qaName, from, to,
        archivedRange: { firstDate: qa.firstDate, lastDate: qa.lastDate },
        days,
        total: matched.length, returned: Math.min(matched.length, limit),
        events: matched.slice(0, limit),
      };
    },

    async get_temperature_history(hc3, args: { deviceId: number; from?: number; to?: number; maxPoints?: number }): Promise<any> {
      const id = Number(args.deviceId);
      if (!Number.isInteger(id) || id <= 0) throw new Error('get_temperature_history: deviceId must be a positive integer.');
      const to = Math.floor(Number(args.to ?? Date.now() / 1000));
      const from = Math.floor(Number(args.from ?? to - 86400));
      if (!(from < to)) throw new Error(`get_temperature_history: from (${from}) must be before to (${to}).`);
      const max = Math.min(Math.max(Number(args.maxPoints) || 500, 2), 5000);

      let device: any;
      try { device = await hc3.request(`/api/devices/${id}`); } catch (e: any) {
        if (isNotFound(e)) throw new Error(`get_temperature_history: no device ${id} on this HC3. Find the right id with find_devices_by_name or get_devices.`);
        throw e;
      }
      const raw: any = await hc3.request(`/api/temperature/${from}/${to}/summary-graph/devices/temperature/${id}`);
      const series: Array<[number, number]> = (Array.isArray(raw) ? raw : [])
        .filter((p: any) => Array.isArray(p) && p.length >= 2)
        .map((p: any) => [Math.round(Number(p[0]) / 1000), Number(p[1])] as [number, number]);

      let points = series;
      if (series.length > max) {
        const step = (series.length - 1) / (max - 1);
        points = Array.from({ length: max }, (_, i) => series[Math.round(i * step)]);
      }
      const values = series.map(p => p[1]).filter(v => Number.isFinite(v));
      return {
        deviceId: id, name: device?.name, from, to,
        total: series.length, returned: points.length,
        ...(values.length ? { min: Math.min(...values), max: Math.max(...values), last: series[series.length - 1] } : {}),
        ...(series.length === 0 ? { note: 'No readings logged in this window. For a QuickApp device, check that saveLogs is on.' } : {}),
        points,
      };
    },
  },
};
