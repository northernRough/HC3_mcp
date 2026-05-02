// Snapshot tool — single-call dump of every mutable HC3 configuration
// surface for backup regimes and drift detection. Read-only; uses
// Promise.allSettled across all selected surfaces so a single endpoint
// failure produces a surfaceErrors entry rather than aborting the run.

import { ToolModule } from './registry';

export const snapshot: ToolModule = {
  schemas: [
      {
        name: 'snapshot',
        description: 'Single-call dump of every mutable HC3 configuration surface for backups, drift detection, and baseline regimes. Read-only. Parallel fetches all selected surfaces with per-surface atomicity (Promise.allSettled — one failing surface doesn\'t abort the others; failures land in surfaceErrors). Default include set: devices, rooms, scenes (with content), quickapps (with files), globals, custom-events, alarm, climate, system, users, hc3-docs. Opt-in only: zwave-parameters (per-device iteration over ~900 devices — adds 90+ seconds to the run). Returns { capturedAt, elapsedMs, surfaces: {...}, surfaceErrors: {...} }. Use for nightly backup scripts and post-incident recovery baselines.',
        inputSchema: {
          type: 'object',
          properties: {
            include: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['devices','rooms','scenes','quickapps','globals','custom-events','alarm','climate','system','users','hc3-docs','zwave-parameters']
              },
              description: 'Optional surfaces to include. Defaults to all except zwave-parameters.'
            },
            exclude: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional surfaces to exclude from the default set. Ignored if include is supplied.'
            }
          }
        }
      },
  ],

  handlers: {
    async snapshot(hc3, args: { include?: string[]; exclude?: string[] }): Promise<any> {
      const DEFAULT_INCLUDE = [
        'devices','rooms','scenes','quickapps','globals','custom-events',
        'alarm','climate','system','users','hc3-docs'
      ];
      const ALL = [...DEFAULT_INCLUDE, 'zwave-parameters'];

      let selected: string[];
      if (args?.include && args.include.length > 0) {
        selected = args.include.filter(s => ALL.includes(s));
      } else {
        const excludeSet = new Set(args?.exclude ?? []);
        selected = DEFAULT_INCLUDE.filter(s => !excludeSet.has(s));
      }

      const started = Date.now();
      const surfaces: Record<string, any> = {};
      const surfaceErrors: Record<string, string> = {};

      // Simple surfaces: one endpoint, pass through
      const simple: Record<string, string> = {
        'devices': '/api/devices',
        'rooms': '/api/rooms',
        'scenes': '/api/scenes',
        'globals': '/api/globalVariables',
        'custom-events': '/api/customEvents',
        'alarm': '/api/alarms/v1/partitions',
        'climate': '/api/panels/climate',
        'system': '/api/settings/info',
        'users': '/api/users',
      };

      const jobs: Promise<void>[] = [];

      for (const name of selected) {
        if (name in simple) {
          jobs.push(
            hc3.request(simple[name])
              .then((v: any) => { surfaces[name] = v; })
              .catch((e: any) => { surfaceErrors[name] = String(e?.message ?? e); })
          );
          continue;
        }

        if (name === 'hc3-docs') {
          jobs.push((async () => {
            const docs: Record<string, any> = {};
            await Promise.allSettled([
              hc3.request('/assets/docs/hc/plugins.json')
                .then((v: any) => { docs['plugins.json'] = v; })
                .catch((e: any) => { surfaceErrors['hc3-docs.plugins.json'] = String(e?.message ?? e); }),
              hc3.request('/assets/docs/hc/quickapp.json')
                .then((v: any) => { docs['quickapp.json'] = v; })
                .catch((e: any) => { surfaceErrors['hc3-docs.quickapp.json'] = String(e?.message ?? e); })
            ]);
            surfaces['hc3-docs'] = docs;
          })());
          continue;
        }

        if (name === 'quickapps') {
          jobs.push((async () => {
            try {
              const qas: any[] = await hc3.request('/api/devices?interface=quickApp');
              const result: any[] = [];
              await Promise.allSettled(qas.map(async (qa: any) => {
                try {
                  const fileList: any[] = await hc3.request(`/api/quickApp/${qa.id}/files`);
                  const files = await Promise.allSettled(
                    (fileList ?? []).map(async f => {
                      try {
                        const content: any = await hc3.request(
                          `/api/quickApp/${qa.id}/files/${encodeURIComponent(f.name)}`
                        );
                        return { name: f.name, isMain: !!f.isMain, isOpen: !!f.isOpen, type: f.type ?? null, content: content?.content ?? '' };
                      } catch (e: any) {
                        surfaceErrors[`quickapps.${qa.id}.${f.name}`] = String(e?.message ?? e);
                        return null;
                      }
                    })
                  );
                  const filesOk = files
                    .filter(r => r.status === 'fulfilled' && r.value)
                    .map(r => (r as PromiseFulfilledResult<any>).value);
                  result.push({ id: qa.id, name: qa.name, type: qa.type, roomID: qa.roomID, files: filesOk });
                } catch (e: any) {
                  surfaceErrors[`quickapps.${qa.id}`] = String(e?.message ?? e);
                }
              }));
              surfaces['quickapps'] = result;
            } catch (e: any) {
              surfaceErrors['quickapps'] = String(e?.message ?? e);
            }
          })());
          continue;
        }

        if (name === 'zwave-parameters') {
          jobs.push((async () => {
            try {
              const devices: any[] = await hc3.request('/api/devices?interface=zwave');
              const parents = devices.filter(d => {
                const nid = d?.properties?.nodeId;
                return typeof nid === 'number' && (d.parentId === 1 || d.parentId === 0);
              });
              const result: any[] = [];
              const concurrency = 8;
              for (let i = 0; i < parents.length; i += concurrency) {
                const batch = parents.slice(i, i + concurrency);
                const settled = await Promise.allSettled(batch.map(async d => {
                  const nid = d.properties.nodeId;
                  const ep = d.properties.endPointId ?? 0;
                  const addr = `${nid}.${ep}`;
                  try {
                    const v: any = await hc3.request(
                      `/api/zwave/configuration_parameters/${encodeURIComponent(addr)}`
                    );
                    return { deviceId: d.id, nodeId: nid, addr, parameters: v?.items ?? [] };
                  } catch (e: any) {
                    surfaceErrors[`zwave-parameters.${d.id}`] = String(e?.message ?? e);
                    return null;
                  }
                }));
                for (const r of settled) {
                  if (r.status === 'fulfilled' && r.value) result.push(r.value);
                }
              }
              surfaces['zwave-parameters'] = result;
            } catch (e: any) {
              surfaceErrors['zwave-parameters'] = String(e?.message ?? e);
            }
          })());
          continue;
        }
      }

      await Promise.allSettled(jobs);

      return {
        capturedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        surfaces,
        surfaceErrors,
        includeResolved: selected
      };
    },
  },
};
