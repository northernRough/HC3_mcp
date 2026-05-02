// Audit tools — read-only, batch, dev-time. Cross-cut multiple HC3 surfaces
// (QAs, scenes, globals, devices) to answer questions a single-domain tool can't.
// Stateless: no mutation of HC3 or local files. Cost: each tool fetches every
// QA + scene + global, so expect 30-90s on typical HC3 installs.

import { ToolModule } from './registry';

// Match a numeric id as a whole word (so 2494 doesn't match 24941).
// Use new RegExp on each call to allow per-id construction.
function makeIdRegex(id: number): RegExp {
  return new RegExp(`\\b${id}\\b`, 'g');
}

// Trim a snippet to ~120 chars centered on the match, with leading/trailing whitespace
// collapsed so the output is grep-friendly.
function makeSnippet(line: string, matchIndex: number): string {
  const collapsed = line.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 120) return collapsed;
  const start = Math.max(0, matchIndex - 50);
  const end = Math.min(collapsed.length, start + 120);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < collapsed.length ? '…' : '';
  return prefix + collapsed.slice(start, end) + suffix;
}

// Search a multi-line text for any of the queried ids.
// Returns hits ordered by line number.
function findHitsInText(
  text: string,
  ids: number[],
  opts: { includeComments: boolean }
): Array<{ id: number; line: number; snippet: string }> {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const hits: Array<{ id: number; line: number; snippet: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!opts.includeComments && /^\s*--/.test(line)) continue;
    for (const id of ids) {
      const re = makeIdRegex(id);
      const m = re.exec(line);
      if (m) {
        hits.push({ id, line: i + 1, snippet: makeSnippet(line, m.index) });
      }
    }
  }
  return hits;
}

// Walk a JSON-typed scene's parsed content tree for any field literally named
// `deviceId` whose value matches a queried id. Block-editor scenes nest
// deviceId references in arbitrarily deep action/condition arrays.
function walkJsonForDeviceIds(
  node: any,
  ids: Set<number>,
  out: Array<{ id: number; path: string }>,
  pathSegs: string[] = []
): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkJsonForDeviceIds(node[i], ids, out, [...pathSegs, `[${i}]`]);
    }
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'deviceId' && typeof v === 'number' && ids.has(v)) {
      out.push({ id: v, path: [...pathSegs].join('.') || '(root)' });
    }
    walkJsonForDeviceIds(v, ids, out, [...pathSegs, k]);
  }
}

interface AuditArgs {
  deviceId?: number;
  name?: string;
  includeChildren?: boolean;
  includeComments?: boolean;
}

interface ReferenceHit {
  kind: 'qa_file' | 'scene_actions' | 'scene_conditions' | 'scene_json' | 'global_var';
  id: number;
  // QA fields
  qaDeviceId?: number;
  qaName?: string;
  fileName?: string;
  // Scene fields
  sceneId?: number;
  sceneName?: string;
  sceneType?: string;
  jsonPath?: string;
  // Global fields
  name?: string;
  // All
  line?: number;
  snippet?: string;
}

// Hard ceiling on total bytes scanned across all QAs + scenes + globals.
// Beyond this, the tool returns partial results with truncated: true.
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

export const audit: ToolModule = {
  schemas: [
    {
      name: 'audit_id_references',
      description:
        'Find every place a device id is referenced — across all QuickApp source files, ' +
        'every Lua scene (actions + conditions) and JSON scene (action tree), and every ' +
        'global variable\'s string value. Universal HC3 question: "if I delete or replace ' +
        'this device, what breaks?" Pass deviceId or name (resolves to ids); set ' +
        'includeChildren=true (default) to also audit child devices of a parent. ' +
        'Stateless audit; does not modify HC3 or local files. ' +
        'Cost: fetches every QA file + scene + global on the HC3; expect 30-90s on a ' +
        'typical install. Hard cap of 5 MB total content scanned; beyond that, response ' +
        'has truncated: true.',
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: {
            type: 'number',
            description: 'The device id to audit. Provide either this or name.',
          },
          name: {
            type: 'string',
            description: 'Audit by current device name. Resolves to one or more ids first via /api/devices?name=<name>. Provide either this or deviceId.',
          },
          includeChildren: {
            type: 'boolean',
            description: 'If deviceId is a parent, also audit each child id (parentId match). Default true.',
          },
          includeComments: {
            type: 'boolean',
            description: 'If false (default), skip lines that look like Lua comments (^\\s*--). Set true to include everything; let the human filter.',
          },
        },
      },
    },
  ],

  handlers: {
    async audit_id_references(hc3, args: AuditArgs): Promise<any> {
      const includeChildren = args.includeChildren !== false; // default true
      const includeComments = args.includeComments === true; // default false

      // 1. Resolve target ids.
      let queriedIds: number[] = [];
      let deviceName: string | undefined;
      if (args.deviceId != null) {
        queriedIds = [args.deviceId];
        try {
          const dev = await hc3.request(`/api/devices/${args.deviceId}`) as any;
          deviceName = dev?.name;
        } catch {
          // device may not exist — still useful to audit references to a dangling id
        }
      } else if (args.name) {
        const matches = await hc3.request(`/api/devices?name=${encodeURIComponent(args.name)}`) as any[];
        queriedIds = (matches || [])
          .filter(d => !d?.deleted)
          .map(d => d.id)
          .filter(id => typeof id === 'number');
        deviceName = args.name;
        if (queriedIds.length === 0) {
          throw new Error(`No non-deleted devices found with name '${args.name}'.`);
        }
      } else {
        throw new Error('Either deviceId or name must be provided.');
      }

      // 2. Expand to children if requested (only meaningful when starting from a single id).
      if (includeChildren && args.deviceId != null) {
        try {
          const children = await hc3.request(`/api/devices?parentId=${args.deviceId}`) as any[];
          for (const c of (children || [])) {
            if (typeof c?.id === 'number' && !queriedIds.includes(c.id)) {
              queriedIds.push(c.id);
            }
          }
        } catch {
          // tolerate; report what we have
        }
      }

      const idSet = new Set(queriedIds);
      const references: ReferenceHit[] = [];
      let bytesScanned = 0;
      let truncated = false;
      const stats = { qaFilesScanned: 0, scenesScanned: 0, globalsScanned: 0 };

      const checkBudget = (size: number): boolean => {
        if (truncated) return false;
        if (bytesScanned + size > MAX_SCAN_BYTES) {
          truncated = true;
          return false;
        }
        bytesScanned += size;
        return true;
      };

      // 3. Walk QAs and their files. /api/quickApp/ returns 501 on current
      // firmware (5.20x); enumerate via /api/devices?interface=quickApp instead.
      // Per-file /files response carries metadata only (name, isMain, isOpen) —
      // content has to be fetched separately via /files/{name}.
      try {
        const qas = await hc3.request('/api/devices?interface=quickApp') as any[];
        for (const qa of (qas || [])) {
          if (truncated) break;
          if (typeof qa?.id !== 'number') continue;
          let fileMetas: any[];
          try {
            fileMetas = await hc3.request(`/api/quickApp/${qa.id}/files`) as any[];
          } catch {
            continue;
          }
          for (const meta of (fileMetas || [])) {
            if (truncated) break;
            if (typeof meta?.name !== 'string') continue;
            let file: any;
            try {
              file = await hc3.request(`/api/quickApp/${qa.id}/files/${encodeURIComponent(meta.name)}`);
            } catch {
              continue;
            }
            const content: string = typeof file?.content === 'string' ? file.content : '';
            if (!content) continue;
            if (!checkBudget(content.length)) break;
            stats.qaFilesScanned++;
            const hits = findHitsInText(content, queriedIds, { includeComments });
            for (const h of hits) {
              references.push({
                kind: 'qa_file',
                id: h.id,
                qaDeviceId: qa.id,
                qaName: qa.name,
                fileName: meta.name,
                line: h.line,
                snippet: h.snippet,
              });
            }
          }
        }
      } catch {
        // QAs surface failed; continue with the rest
      }

      // 4. Walk scenes — Lua actions/conditions and JSON action trees.
      try {
        const scenes = await hc3.request('/api/scenes') as any[];
        for (const sc of (scenes || [])) {
          if (truncated) break;
          if (typeof sc?.id !== 'number') continue;
          stats.scenesScanned++;
          const sceneType: string = sc.type ?? 'unknown';
          // Lua/scenario scenes: content is a JSON-encoded {conditions, actions} pair
          // where each value is a Lua string.
          if (sceneType === 'lua' || sceneType === 'scenario') {
            let content: any;
            if (typeof sc.content === 'string') {
              try { content = JSON.parse(sc.content); } catch { content = null; }
            } else {
              content = sc.content;
            }
            const actions: string = typeof content?.actions === 'string' ? content.actions : '';
            const conds: string = typeof content?.conditions === 'string' ? content.conditions : '';
            if (actions && checkBudget(actions.length)) {
              for (const h of findHitsInText(actions, queriedIds, { includeComments })) {
                references.push({
                  kind: 'scene_actions',
                  id: h.id,
                  sceneId: sc.id,
                  sceneName: sc.name,
                  sceneType,
                  line: h.line,
                  snippet: h.snippet,
                });
              }
            }
            if (conds && !truncated && checkBudget(conds.length)) {
              for (const h of findHitsInText(conds, queriedIds, { includeComments })) {
                references.push({
                  kind: 'scene_conditions',
                  id: h.id,
                  sceneId: sc.id,
                  sceneName: sc.name,
                  sceneType,
                  line: h.line,
                  snippet: h.snippet,
                });
              }
            }
            continue;
          }
          // JSON (block-editor) scenes: walk the parsed action tree for `deviceId` fields.
          if (sceneType === 'json') {
            let content: any = sc.content;
            if (typeof content === 'string') {
              try { content = JSON.parse(content); } catch { content = null; }
            }
            const serialised = JSON.stringify(content ?? {});
            if (!checkBudget(serialised.length)) break;
            const out: Array<{ id: number; path: string }> = [];
            walkJsonForDeviceIds(content, idSet, out);
            for (const w of out) {
              references.push({
                kind: 'scene_json',
                id: w.id,
                sceneId: sc.id,
                sceneName: sc.name,
                sceneType,
                jsonPath: w.path,
              });
            }
          }
        }
      } catch {
        // scenes surface failed; continue
      }

      // 5. Walk globals.
      try {
        const globals = await hc3.request('/api/globalVariables') as any[];
        for (const g of (globals || [])) {
          if (truncated) break;
          stats.globalsScanned++;
          const value: string = typeof g?.value === 'string' ? g.value : '';
          if (!value) continue;
          if (!checkBudget(value.length)) break;
          // Globals are typically single-line JSON-encoded blobs; treat the whole value as one line.
          for (const id of queriedIds) {
            const re = makeIdRegex(id);
            const m = re.exec(value);
            if (m) {
              references.push({
                kind: 'global_var',
                id,
                name: g.name,
                snippet: makeSnippet(value, m.index),
              });
            }
          }
        }
      } catch {
        // globals surface failed; continue
      }

      // 6. Return.
      return {
        queriedIds,
        deviceName,
        references,
        stats: {
          ...stats,
          totalHits: references.length,
          bytesScanned,
        },
        truncated,
      };
    },
  },
};
