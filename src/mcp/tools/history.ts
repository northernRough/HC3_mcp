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
  ],
  handlers: {
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
