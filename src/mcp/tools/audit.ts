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
    {
      name: 'audit_qa_devices',
      description:
        'For a given QuickApp, parse every numeric device id its source files reference and ' +
        'classify each against live HC3 state. Universal HC3 question: "after that recent ' +
        'Z-Wave re-inclusion (or device deletion), is this QA still pointing at real, alive ' +
        'devices?" Walks every file in the QA, extracts every \\b\\d{2,5}\\b numeric token ' +
        '(skipping master device 1 and the SceneManager-style noise patterns; see below), ' +
        'and classifies each unique id as ALIVE, DEAD, or DELETED via /api/devices/{id} ' +
        '(checking properties.dead and properties.deleted, not just the top-level fields ' +
        'which are usually null even on confirmed-dead devices). Issues are grouped by id ' +
        'with all source occurrences (file, line, snippet) attached. ' +
        'Stateless audit; does not modify HC3 or local files. ' +
        'Cost: fetches every QA file plus one /api/devices/{id} per unique candidate id; ' +
        'expect 10-30s on a typical QA. ' +
        'False-positive caveats: the heuristic skips ids < 100, lines containing ' +
        '"triggerId =", whole-line Lua comments, lines with magic-number field names ' +
        '(pollInterval, maxSeconds, etc.), and lines with arithmetic-on-time patterns ' +
        '(* 1000, + 86400). Residual false-positives in the DELETED bucket are common ' +
        'for SceneManager-style codebases — table-of-trigger-id rows like ' +
        '"triggers = {901, 902}" and reserved-trigger constants in function args ' +
        '(manualTrigger(..., 999, ...)) will appear as DELETED issues. Treat the issues ' +
        'list as a starting point for review rather than a definitive list; the DEAD ' +
        'classification is high-confidence (HC3 confirms the device is real and dead).',
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: {
            type: 'number',
            description: 'QA device id to audit. Must be a QuickApp (interfaces includes \'quickApp\'); the tool throws otherwise.',
          },
          fileNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: specific files to scan. Default: all files in the QA.',
          },
        },
        required: ['deviceId'],
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

    async audit_qa_devices(
      hc3,
      args: { deviceId: number; fileNames?: string[] },
    ): Promise<any> {
      if (typeof args?.deviceId !== 'number') {
        throw new Error('deviceId is required.');
      }

      // 1. Verify the target is a QuickApp.
      const qa = await hc3.request(`/api/devices/${args.deviceId}`) as any;
      const isQA = Array.isArray(qa?.interfaces) && qa.interfaces.includes('quickApp');
      if (!isQA) {
        throw new Error(
          `Device ${args.deviceId} exists but is not a QuickApp (its interfaces do not include 'quickApp'). audit_qa_devices is for QA source-file audit; use audit_id_references for non-QA references.`,
        );
      }

      // 2. List files; the /files response carries metadata only — fetch
      // each file's content via /files/{name} (the /files response carries
      // metadata only; content has to be pulled per file).
      const fileMetas = await hc3.request(`/api/quickApp/${args.deviceId}/files`) as any[];
      const wanted = new Set(args.fileNames ?? fileMetas.map(m => m?.name).filter(n => typeof n === 'string'));
      const files: Array<{ name: string; content: string }> = [];
      for (const meta of (fileMetas || [])) {
        if (typeof meta?.name !== 'string') continue;
        if (!wanted.has(meta.name)) continue;
        try {
          const f = await hc3.request(`/api/quickApp/${args.deviceId}/files/${encodeURIComponent(meta.name)}`) as any;
          if (typeof f?.content === 'string') {
            files.push({ name: meta.name, content: f.content });
          }
        } catch {
          // skip a file that fails to fetch
        }
      }

      // 3. Extract candidate ids from every line.
      //
      // Heuristic: \b(\d{2,5})\b, with four cheap noise filters tuned to
      // SceneManager-style codebases (heaviest user of these tools):
      //
      //  - **Skip ids < 100.** HC3 user-device ids start in the high hundreds
      //    or low thousands; the 1-99 range is dominated by SceneManager's
      //    own internal trigger-id namespace and by digits-in-strings like
      //    "06:00" timestamps. Real user devices < 100 do exist on some
      //    installations — those will be missed; future versions may add a
      //    `minDeviceId` option to lower the floor.
      //
      //  - **Skip Lua comment lines** (lines whose first non-whitespace is
      //    `--`). Comments commonly reference reserved trigger ids in
      //    documentation tables (`-- 901 isDark = "true" — sunset`), magic
      //    numbers in explanatory prose, dates (`2026-04-22`), and
      //    cross-references to old/replaced device ids. None are live device
      //    references; classifying them as DELETED would drown the real
      //    signal. Inline `--` comments at the end of a code line are still
      //    scanned — only whole-line comments are skipped.
      //
      //  - **Skip lines that contain `triggerId\s*=`.** SceneManager has
      //    trigger ids in the 100+ range (e.g. trigger 100 = Lounge alternate
      //    sunset) that overlap with real device ids. Rejecting any line
      //    that assigns to triggerId removes that whole class of noise.
      //
      //  - **Skip lines whose match sits inside a magic-number / time /
      //    config field** (denylist below). Catches `pollInterval = 100`,
      //    `autoDelayDefault = 300`, `maxSeconds = 600`, `seconds = 180`,
      //    arithmetic on time constants like `* 1000` or `+ 86400`, etc.
      //
      // All four filters are heuristic. The intent is "high signal, low
      // noise" for the typical SceneManager-style codebase rather than
      // perfect recall. Tolerate the residue; mention false-positive risk
      // in the tool description so callers know to glance at issues
      // critically.
      const idRegex = /\b(\d{2,5})\b/g;
      const commentLineMarker = /^\s*--/;
      const triggerIdLineMarker = /\btriggerId\s*=/;
      // Field names that are NOT device-id references in any HC3 codebase
      // we've seen (time / count / size / generic-magic-number contexts).
      // If a line assigns to one of these names, skip it entirely.
      const magicFieldDenylistMarker = new RegExp(
        '\\b(?:pollInterval|pollMs|interval|autoDelayDefault|autoDelay|delaySeconds|delayMs|delay|timeoutMs|timeout|maxSeconds|maxMs|seconds|ms|hours|minutes|days|count|priority|weight|level|version|year|month|day|hour|minute|kwh|wattage|battery)\\s*=',
      );
      // Common arithmetic-on-time patterns — `* 1000`, `+ 86400`, etc.
      const timeArithMarker = /[*+\-]\s*\d+|\d+\s*[*+]/;

      const occurrencesByFile: Array<{ name: string; lines: number; perLine: Array<{ line: number; ids: number[]; snippet: string }> }> = [];
      const candidateIds = new Set<number>();
      let totalLines = 0;
      for (const f of files) {
        const lines = f.content.split(/\r?\n/);
        totalLines += lines.length;
        const perLine: Array<{ line: number; ids: number[]; snippet: string }> = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (commentLineMarker.test(line)) continue;
          if (triggerIdLineMarker.test(line)) continue;
          if (magicFieldDenylistMarker.test(line)) continue;
          // Strip end-of-line comments so a real code line with a trailing
          // `-- comment with 100` doesn't pick up the 100. Use the first
          // standalone `--` outside of a string literal as the cut point;
          // a regex approximation is good enough.
          const codeOnly = line.replace(/(["']).*?\1|--.*$/g, (m, q) => q ? m : '');
          // After stripping comments, also bail if line is dominated by
          // arithmetic-on-time constants (e.g. `setTimeout(fn, 1000 * 60)`).
          if (timeArithMarker.test(codeOnly)) continue;
          const idsOnLine: number[] = [];
          let m;
          idRegex.lastIndex = 0;
          while ((m = idRegex.exec(codeOnly)) !== null) {
            const id = parseInt(m[1], 10);
            if (id < 100) continue;
            idsOnLine.push(id);
            candidateIds.add(id);
          }
          if (idsOnLine.length > 0) {
            perLine.push({
              line: i + 1,
              ids: idsOnLine,
              snippet: makeSnippet(line, 0),
            });
          }
        }
        occurrencesByFile.push({ name: f.name, lines: lines.length, perLine });
      }

      // 4. Classify each unique candidate id against live HC3 state.
      //
      // /api/devices/{id} response shape: HC3 records `dead` and `deleted`
      // flags at `properties.dead` / `properties.deleted` rather than at
      // the top level (the top-level `dead`/`deleted` keys do exist on
      // some firmware revisions but are usually null even when the device
      // is in fact dead). Check both locations to be defensive.
      //
      // Classification:
      //   404 → DELETED (device gone from HC3 entirely)
      //   properties.deleted == true OR top-level deleted == true → DELETED
      //   properties.dead == true OR top-level dead == true → DEAD
      //   else → ALIVE
      //
      // Per-id cache so a busy QA file referencing the same id 50 times
      // only triggers one HTTP lookup.
      const classification = new Map<number, 'ALIVE' | 'DEAD' | 'DELETED'>();
      const deviceMeta = new Map<number, { name?: string; type?: string }>();
      for (const id of candidateIds) {
        try {
          const dev = await hc3.request(`/api/devices/${id}`) as any;
          const props = dev?.properties ?? {};
          const isDeleted = props?.deleted === true || dev?.deleted === true;
          const isDead = props?.dead === true || dev?.dead === true;
          if (isDeleted) {
            classification.set(id, 'DELETED');
            deviceMeta.set(id, { name: dev?.name, type: dev?.type });
          } else if (isDead) {
            classification.set(id, 'DEAD');
            deviceMeta.set(id, { name: dev?.name, type: dev?.type });
          } else {
            classification.set(id, 'ALIVE');
            deviceMeta.set(id, { name: dev?.name, type: dev?.type });
          }
        } catch (e: any) {
          const msg = (e?.message ?? '').toString();
          if (msg.includes('HTTP 404')) {
            classification.set(id, 'DELETED');
          } else {
            // Treat any other failure as unknown — record but don't block.
            classification.set(id, 'DELETED');
          }
        }
      }

      // 5. Group hits by id; report only DEAD / DELETED issues (alive ids
      // are summarised in stats but not enumerated — the caller doesn't
      // need a list of every healthy reference).
      type Issue = { kind: 'DEAD' | 'DELETED'; id: number; name?: string; type?: string; files: Array<{ fileName: string; line: number; snippet: string }> };
      const issuesById = new Map<number, Issue>();
      for (const fileGroup of occurrencesByFile) {
        for (const occ of fileGroup.perLine) {
          for (const id of occ.ids) {
            const cls = classification.get(id);
            if (cls !== 'DEAD' && cls !== 'DELETED') continue;
            const meta = deviceMeta.get(id);
            let issue = issuesById.get(id);
            if (!issue) {
              issue = { kind: cls, id, name: meta?.name, type: meta?.type, files: [] };
              issuesById.set(id, issue);
            }
            issue.files.push({ fileName: fileGroup.name, line: occ.line, snippet: occ.snippet });
          }
        }
      }
      const issues = Array.from(issuesById.values()).sort((a, b) => {
        // DEAD first (recoverable), then DELETED (gone), then by id ascending.
        if (a.kind !== b.kind) return a.kind === 'DEAD' ? -1 : 1;
        return a.id - b.id;
      });

      // 6. Tally summary counts from the classification map.
      let alive = 0, dead = 0, deleted = 0;
      for (const cls of classification.values()) {
        if (cls === 'ALIVE') alive++;
        else if (cls === 'DEAD') dead++;
        else if (cls === 'DELETED') deleted++;
      }

      return {
        qa: { id: args.deviceId, name: qa?.name, type: qa?.type },
        scanned: { fileCount: files.length, totalLines },
        summary: {
          idsReferenced: candidateIds.size,
          alive,
          dead,
          deleted,
        },
        issues,
        parseErrors: [],
      };
    },
  },
};
