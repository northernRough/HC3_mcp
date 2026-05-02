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
          bindAware: {
            type: 'boolean',
            description: 'If true, also parse bind("RoleStem", { ... }) descriptor calls from any file and run the L0-L4 resolver waterfall (cached / endpoint / nameInParent / newParentEndpoint / globalName) on each role entry. Reports which descriptors are still resolving via L0 (cached id valid), which have healed via L1-L3 (parent/endpoint/name re-resolution — descriptor cached id is stale and should be updated), which healed via L4 (allowGlobal-only, global name+type match), and which are missing or ambiguous. Adds a bindAware block to the response. Default false.',
          },
          strict: {
            type: 'boolean',
            description: 'If true (and bindAware is true), treat L4-eligible name-drift conflicts and L4 ambiguities as failures (counted in summary.warnings). Default false — those are informational.',
          },
        },
        required: ['deviceId'],
      },
    },
    {
      name: 'introspect_device_group',
      description:
        'Take a numeric Devices.X.Y = { foo = 1234, bar = 5678 } group inside a QA file ' +
        'and return a structured snapshot of the live state behind each id (name, type, ' +
        'parentId, endPointId from /api/devices/{id}). Useful for documenting a group, ' +
        'diffing it against the snapshot tree, or confirming it is still pointing at the ' +
        'right devices after a Z-Wave re-inclusion. Auto-detects whether the group is ' +
        'endpoint-mode (all entries share a common parentId; each entry is a channel of one ' +
        'physical device, ep numbers are captured) or flat (independent devices, no shared ' +
        'parent). v1 supports json and markdown-table outputs; bind-lua and yaml are ' +
        'planned for a follow-up. Stateless; does not modify HC3 or local files.',
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: {
            type: 'number',
            description: 'QA device id whose file will be read. Must be a QuickApp.',
          },
          fileName: {
            type: 'string',
            description: 'File containing the group definition. Default "config".',
            default: 'config',
          },
          groupPath: {
            type: 'string',
            description: 'Dotted path to the group (last segment is the table being introspected). Example: "Devices.Mae.ensuiteRGBW". The Lua-source parser navigates the path using brace-balanced search; non-trivial paths with shadowed leaf names may resolve to the first match — disambiguate by passing a more specific path in that case.',
          },
          outputFormat: {
            type: 'string',
            enum: ['json', 'markdown-table'],
            description: 'Output shape. json: canonical machine-readable record. markdown-table: H2 heading, parent line (if endpoint mode), and a markdown table of entries. Default json.',
            default: 'json',
          },
          mode: {
            type: 'string',
            enum: ['auto', 'flat', 'endpoint'],
            description: 'Force a particular mode rather than auto-detect. Default auto: endpoint if all entries share a common parentId, flat otherwise.',
            default: 'auto',
          },
        },
        required: ['deviceId', 'groupPath'],
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
      args: { deviceId: number; fileNames?: string[]; bindAware?: boolean; strict?: boolean },
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

      // Optional: bind-aware mode parses bind("RoleStem", { ... }) descriptors
      // and runs the L0-L4 resolver waterfall over each role entry. Adds a
      // bindAware block to the response.
      let bindAwareBlock: any = undefined;
      if (args.bindAware === true) {
        bindAwareBlock = await runBindAwareWaterfall(hc3, files, args.strict === true);
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
        bindAware: bindAwareBlock,
        parseErrors: [],
      };
    },

    async introspect_device_group(
      hc3,
      args: {
        deviceId: number;
        fileName?: string;
        groupPath: string;
        outputFormat?: 'json' | 'markdown-table';
        mode?: 'auto' | 'flat' | 'endpoint';
      },
    ): Promise<any> {
      if (typeof args?.deviceId !== 'number') throw new Error('deviceId is required.');
      if (typeof args?.groupPath !== 'string' || !args.groupPath.includes('.')) {
        throw new Error('groupPath is required and must be a dotted path (e.g. "Devices.Mae.ensuiteRGBW").');
      }
      const fileName = args.fileName ?? 'config';
      const outputFormat = args.outputFormat ?? 'json';
      const mode = args.mode ?? 'auto';

      // 1. Confirm target is a QA, fetch the file content.
      const dev = await hc3.request(`/api/devices/${args.deviceId}`) as any;
      const isQA = Array.isArray(dev?.interfaces) && dev.interfaces.includes('quickApp');
      if (!isQA) {
        throw new Error(
          `Device ${args.deviceId} is not a QuickApp; introspect_device_group operates on QA source files.`,
        );
      }
      const file = await hc3.request(
        `/api/quickApp/${args.deviceId}/files/${encodeURIComponent(fileName)}`,
      ) as any;
      const content: string = typeof file?.content === 'string' ? file.content : '';
      if (!content) {
        throw new Error(`File '${fileName}' on QA ${args.deviceId} is empty or missing.`);
      }

      // 2. Locate the group's body. Walk the dotted path properly so a
      // shadowed leaf name (multiple `ensuiteRGBW = {` blocks under
      // different parents) resolves to the correct one.
      //
      // Strategy: try the longest path prefix as a top-level Lua assignment
      // ("Devices.Mae = {" matches that exact phrasing). Once a prefix
      // matches and brace-balanced scanning gives us its body, descend into
      // the body looking for each remaining segment as a nested key.
      const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const findBalancedOpen = (haystack: string, regex: RegExp): { openIndex: number; closeIndex: number } | null => {
        const m2 = regex.exec(haystack);
        if (!m2) return null;
        const openIndex = m2.index + m2[0].length - 1; // index of the `{`
        let depth = 1;
        for (let i = openIndex + 1; i < haystack.length; i++) {
          const c = haystack[i];
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) return { openIndex, closeIndex: i };
          }
        }
        return null;
      };

      const segments = args.groupPath.split('.').filter(s => s.length > 0);
      let body: string | null = null;
      // Try each prefix from longest to shortest.
      for (let prefixLen = segments.length; prefixLen >= 1; prefixLen--) {
        const prefix = segments.slice(0, prefixLen).join('.');
        const prefixRegex = new RegExp(`(?:^|[^\\w.])${reEsc(prefix)}\\s*=\\s*\\{`);
        const found = findBalancedOpen(content, prefixRegex);
        if (!found) continue;
        let cursor = content.slice(found.openIndex + 1, found.closeIndex);
        // Descend into remaining segments.
        let descentOk = true;
        for (let s = prefixLen; s < segments.length; s++) {
          const key = segments[s];
          const keyRegex = new RegExp(`\\b${reEsc(key)}\\s*=\\s*\\{`);
          const nested = findBalancedOpen(cursor, keyRegex);
          if (!nested) { descentOk = false; break; }
          cursor = cursor.slice(nested.openIndex + 1, nested.closeIndex);
        }
        if (descentOk) { body = cursor; break; }
      }
      if (body === null) {
        // Check whether the path resolves to a bind(...) descriptor — those
        // already carry the live-state shape and don't need introspection.
        const leaf = segments[segments.length - 1];
        const bindRegex = new RegExp(`\\b${reEsc(leaf)}\\s*=\\s*bind\\s*\\(`);
        if (bindRegex.test(content)) {
          throw new Error(
            `Path '${args.groupPath}' resolves to a bind(...) descriptor in '${fileName}', not a numeric { field = id } table. bind() blocks already carry name/type/ep alongside each id, so introspecting them adds nothing — use the descriptor directly. introspect_device_group is for the legacy numeric-table form.`,
          );
        }
        throw new Error(
          `Could not navigate path '${args.groupPath}' in QA ${args.deviceId} file '${fileName}'. Tried each prefix from longest to shortest; none resolved to a table assignment with the remaining segments as nested keys.`,
        );
      }

      // 3. Parse `field = id, ...` pairs from the body.
      // Tolerate trailing commas, end-of-line comments, whitespace.
      // Skip nested tables — if the leaf has them, the entries with `{...}`
      // values get a parseError entry rather than failing the whole call.
      type Entry = { field: string; id: number; live?: any };
      const entries: Entry[] = [];
      const parseErrors: Array<{ field: string; reason: string; raw: string }> = [];
      const pairRegex = /(\w+)\s*=\s*([^,\n]+?)(?:,|$|\n)/g;
      let pm;
      while ((pm = pairRegex.exec(body)) !== null) {
        const field = pm[1];
        const rawValue = pm[2].trim().replace(/--.*$/, '').trim();
        // Numeric literal? capture as id.
        const num = /^(\d+)$/.exec(rawValue);
        if (num) {
          entries.push({ field, id: parseInt(num[1], 10) });
        } else if (/^\{/.test(rawValue)) {
          parseErrors.push({ field, reason: 'nested-table', raw: rawValue.slice(0, 60) });
        } else if (rawValue.length === 0) {
          // skip empty values (likely from a trailing-comma artefact)
        } else {
          parseErrors.push({ field, reason: 'non-numeric', raw: rawValue.slice(0, 60) });
        }
      }
      if (entries.length === 0 && parseErrors.length === 0) {
        throw new Error(
          `Group '${args.groupPath}' in '${fileName}' parsed but contained no numeric field=id pairs. Body was: ${body.trim().slice(0, 200)}`,
        );
      }

      // 4. Resolve each id to live HC3 device record.
      for (const e of entries) {
        try {
          e.live = await hc3.request(`/api/devices/${e.id}`);
        } catch {
          e.live = null;
        }
      }

      // 5. Decide mode (flat vs endpoint).
      const parentIds = new Set<number>();
      for (const e of entries) {
        const pid = e.live?.parentId;
        if (typeof pid === 'number' && pid > 0) parentIds.add(pid);
      }
      const detectedMode: 'flat' | 'endpoint' =
        mode === 'flat' ? 'flat'
        : mode === 'endpoint' ? 'endpoint'
        : (parentIds.size === 1 && entries.length > 1) ? 'endpoint' : 'flat';

      // 6. Capture parent if endpoint mode.
      let parent: { id: number; name?: string; type?: string } | null = null;
      if (detectedMode === 'endpoint' && parentIds.size === 1) {
        const parentId = [...parentIds][0];
        try {
          const p = await hc3.request(`/api/devices/${parentId}`) as any;
          parent = { id: parentId, name: p?.name, type: p?.type };
        } catch {
          parent = { id: parentId };
        }
      }

      // 7. Build the canonical entry list.
      const canonicalEntries = entries.map(e => {
        const live = e.live;
        const out: any = { field: e.field, id: e.id };
        if (detectedMode === 'endpoint' && live?.parentId === parent?.id) {
          if (typeof live?.properties?.endPointId === 'number') {
            out.ep = live.properties.endPointId;
          } else if (typeof live?.endPointId === 'number') {
            out.ep = live.endPointId;
          }
        }
        out.name = live?.name;
        out.type = live?.type;
        return out;
      });

      // 8. Render in requested format.
      if (outputFormat === 'markdown-table') {
        const lines: string[] = [];
        lines.push(`## ${args.groupPath}`);
        lines.push('');
        if (parent) {
          lines.push(`Parent: **${parent.name ?? '(unknown)'}** (id ${parent.id}, ${parent.type ?? '(unknown type)'})`);
          lines.push('');
          lines.push('| Field | id | ep | Name | Type |');
          lines.push('|-------|----|----|------|------|');
          for (const e of canonicalEntries) {
            lines.push(`| ${e.field} | ${e.id} | ${e.ep ?? ''} | ${e.name ?? ''} | ${e.type ?? ''} |`);
          }
        } else {
          lines.push('Flat group (no shared parent detected).');
          lines.push('');
          lines.push('| Field | id | Name | Type |');
          lines.push('|-------|----|------|------|');
          for (const e of canonicalEntries) {
            lines.push(`| ${e.field} | ${e.id} | ${e.name ?? ''} | ${e.type ?? ''} |`);
          }
        }
        return {
          groupPath: args.groupPath,
          detectedMode,
          markdown: lines.join('\n'),
          parent,
          entries: canonicalEntries,
          parseErrors,
        };
      }

      // json (default)
      return {
        groupPath: args.groupPath,
        detectedMode,
        parent,
        entries: canonicalEntries,
        parseErrors,
      };
    },
  },
};

// ---------------------------------------------------------------
// Bind-aware audit helpers — used by audit_qa_devices when bindAware=true.
// ---------------------------------------------------------------

interface BindEntry {
  field: string;     // e.g. "controller", "wallGraze"
  id?: number;
  ep?: number;
  name?: string;
  type?: string;
}
interface BindDescriptor {
  fileName: string;
  role: string;                // the first arg to bind("...", ...)
  parent?: BindEntry;          // the special "parent" entry
  entries: BindEntry[];        // all non-parent entries
  allowGlobal: boolean;        // whether the descriptor opted into L4 fallback
}

// Parse one fields-block body like `id = 2370, ep = 1, name = "12V colours", type = "com.fibaro.FGRGBW442CC"`.
function parseBindEntryFields(body: string): Partial<BindEntry & { allowGlobal: boolean }> {
  const out: any = {};
  const re = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|true|false|-?\d+|[A-Za-z_][\w.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const k = m[1];
    const raw = m[2];
    let v: any = raw;
    if (m[3] !== undefined) v = m[3];
    else if (m[4] !== undefined) v = m[4];
    else if (raw === 'true') v = true;
    else if (raw === 'false') v = false;
    else if (/^-?\d+$/.test(raw)) v = parseInt(raw, 10);
    out[k] = v;
  }
  return out;
}

// Parse all bind("RoleStem", { ... }) blocks from a piece of source content.
// Tolerant regex parser; brace-balanced inner-block extraction so nested
// commas don't confuse the boundary.
function parseBindBlocks(fileName: string, content: string): BindDescriptor[] {
  const out: BindDescriptor[] = [];
  const headRe = /\bbind\s*\(\s*["']([^"']+)["']\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = headRe.exec(content)) !== null) {
    const role = m[1];
    const openBrace = headRe.lastIndex - 1; // index of `{`
    let depth = 1;
    let close = -1;
    for (let i = openBrace + 1; i < content.length; i++) {
      const c = content[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close < 0) continue;
    const body = content.slice(openBrace + 1, close);

    // Inside the body: find every `<field> = { ... }` entry.
    const entryRe = /(\w+)\s*=\s*\{([^}]*)\}/g;
    let em: RegExpExecArray | null;
    let parent: BindEntry | undefined;
    const entries: BindEntry[] = [];
    let allowGlobal = false;
    while ((em = entryRe.exec(body)) !== null) {
      const field = em[1];
      const fields = parseBindEntryFields(em[2]);
      if (field === 'parent') {
        parent = { field, ...fields } as BindEntry;
      } else {
        entries.push({ field, ...fields } as BindEntry);
      }
    }
    // Detect descriptor-level allowGlobal flag (e.g. allowGlobal = true at top level).
    const allowGlobalRe = /\ballowGlobal\s*=\s*true\b/;
    if (allowGlobalRe.test(body)) allowGlobal = true;

    out.push({ fileName, role, parent, entries, allowGlobal });
  }
  return out;
}

type Waterfall = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5_missing' | 'L4_ambiguous';
interface DescriptorResult {
  role: string;
  field: string;
  level: Waterfall;
  cachedId?: number;
  resolvedId?: number;
  note?: string;
}

async function runBindAwareWaterfall(
  hc3: any,
  files: Array<{ name: string; content: string }>,
  strict: boolean,
): Promise<any> {
  // 1. Parse every bind() block from every file.
  const descriptors: BindDescriptor[] = [];
  for (const f of files) {
    descriptors.push(...parseBindBlocks(f.name, f.content));
  }

  if (descriptors.length === 0) {
    return {
      enabled: true,
      summary: { descriptorTotal: 0, ok_l0: 0, healed_l1_l3: 0, healed_l4: 0, missing: 0, ambiguous: 0, warnings: 0 },
      descriptors: [],
      descriptorIssues: [],
      warnings: [],
    };
  }

  // 2. Fetch all alive devices once for resolver lookups. Filter out deleted.
  const allDevices: any[] = await hc3.request('/api/devices') as any[];
  const aliveDevices = (allDevices || []).filter(d => !d?.deleted);
  // Index by id for O(1) lookup.
  const byId = new Map<number, any>();
  for (const d of aliveDevices) {
    if (typeof d?.id === 'number') byId.set(d.id, d);
  }
  // Index by parentId for sibling lookups.
  const byParent = new Map<number, any[]>();
  for (const d of aliveDevices) {
    const pid = typeof d?.parentId === 'number' ? d.parentId : -1;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(d);
  }

  const epOf = (d: any): number | undefined => {
    const ep = d?.properties?.endPointId ?? d?.endPointId;
    return typeof ep === 'number' ? ep : undefined;
  };

  // 3. For each descriptor, walk L0-L4 on each non-parent entry.
  const results: DescriptorResult[] = [];
  const warnings: string[] = [];
  for (const desc of descriptors) {
    const parentId = desc.parent?.id;
    const parentChildren = parentId !== undefined ? (byParent.get(parentId) ?? []) : [];

    for (const entry of desc.entries) {
      const wantType = entry.type;
      const wantEp = entry.ep;
      const wantName = entry.name;

      // L0 — cached id valid AND parent/ep/type match.
      if (entry.id !== undefined) {
        const live = byId.get(entry.id);
        if (live
            && (parentId === undefined || live?.parentId === parentId)
            && (wantEp === undefined || epOf(live) === wantEp)
            && (wantType === undefined || live?.type === wantType)) {
          results.push({ role: desc.role, field: entry.field, level: 'L0', cachedId: entry.id, resolvedId: entry.id });
          continue;
        }
      }

      // L1 — sibling under cached parent with matching ep + type.
      if (parentId !== undefined && wantEp !== undefined && wantType !== undefined) {
        const candidates = parentChildren.filter(d =>
          epOf(d) === wantEp && d?.type === wantType);
        if (candidates.length === 1) {
          const c = candidates[0];
          results.push({
            role: desc.role, field: entry.field, level: 'L1',
            cachedId: entry.id, resolvedId: c.id,
            note: 'Resolved by endpoint match — descriptor cached id is stale; recommend updating descriptor.',
          });
          continue;
        }
      }

      // L2 — sibling under cached parent with matching name + type.
      if (parentId !== undefined && wantName !== undefined && wantType !== undefined) {
        const candidates = parentChildren.filter(d =>
          d?.name === wantName && d?.type === wantType);
        if (candidates.length === 1) {
          const c = candidates[0];
          results.push({
            role: desc.role, field: entry.field, level: 'L2',
            cachedId: entry.id, resolvedId: c.id,
            note: 'Resolved by name match under same parent — descriptor cached id (and possibly endpoint) is stale.',
          });
          continue;
        }
      }

      // L3 — re-resolve parent by name+type, then look for child by ep+type.
      if (desc.parent?.name && desc.parent?.type && wantEp !== undefined && wantType !== undefined) {
        const newParentCandidates = aliveDevices.filter(d =>
          d?.name === desc.parent!.name && d?.type === desc.parent!.type);
        if (newParentCandidates.length === 1) {
          const newParent = newParentCandidates[0];
          const siblings = byParent.get(newParent.id) ?? [];
          const candidates = siblings.filter(d =>
            epOf(d) === wantEp && d?.type === wantType);
          if (candidates.length === 1) {
            results.push({
              role: desc.role, field: entry.field, level: 'L3',
              cachedId: entry.id, resolvedId: candidates[0].id,
              note: `Parent re-resolved (cached id ${parentId} -> ${newParent.id}); endpoint matched under new parent.`,
            });
            continue;
          }
        }
      }

      // L4 — global name+type match. Only if descriptor opted into allowGlobal.
      if (desc.allowGlobal && wantName !== undefined && wantType !== undefined) {
        const candidates = aliveDevices.filter(d =>
          d?.name === wantName && d?.type === wantType);
        if (candidates.length === 1) {
          results.push({
            role: desc.role, field: entry.field, level: 'L4',
            cachedId: entry.id, resolvedId: candidates[0].id,
            note: 'Resolved by global name+type — last-resort fallback under allowGlobal=true.',
          });
          continue;
        }
        if (candidates.length > 1) {
          results.push({
            role: desc.role, field: entry.field, level: 'L4_ambiguous',
            cachedId: entry.id,
            note: `Global name+type match returned ${candidates.length} candidates; cannot disambiguate.`,
          });
          continue;
        }
      } else if (!desc.allowGlobal && wantName !== undefined && wantType !== undefined) {
        // Even with allowGlobal=false, surface a warning if a global match
        // would have been ambiguous — that means enabling allowGlobal would
        // be unsafe for this descriptor. Spec calls this out.
        const globalMatches = aliveDevices.filter(d =>
          d?.name === wantName && d?.type === wantType);
        if (globalMatches.length > 1) {
          warnings.push(
            `${desc.role}.${entry.field} has allowGlobal=false but name '${wantName}' matches ${globalMatches.length} devices of type ${wantType} globally — fine for now, but enabling allowGlobal would be unsafe.`,
          );
        }
      }

      // L5 — nothing matched.
      results.push({
        role: desc.role, field: entry.field, level: 'L5_missing',
        cachedId: entry.id,
        note: 'No level (L0-L4) resolved this entry.',
      });
    }
  }

  // 4. Summarise.
  const counts = { ok_l0: 0, healed_l1_l3: 0, healed_l4: 0, missing: 0, ambiguous: 0 };
  for (const r of results) {
    if (r.level === 'L0') counts.ok_l0++;
    else if (r.level === 'L1' || r.level === 'L2' || r.level === 'L3') counts.healed_l1_l3++;
    else if (r.level === 'L4') counts.healed_l4++;
    else if (r.level === 'L5_missing') counts.missing++;
    else if (r.level === 'L4_ambiguous') counts.ambiguous++;
  }

  // strict mode: count L4 hits and warnings as failures.
  const strictFailures = strict ? (counts.healed_l4 + warnings.length) : 0;

  // Issues = anything not L0.
  const descriptorIssues = results
    .filter(r => r.level !== 'L0')
    .map(r => ({
      role: `${r.role}.${r.field}`,
      level: r.level,
      currentId: r.resolvedId,
      previousCachedId: r.cachedId,
      note: r.note,
    }));

  return {
    enabled: true,
    summary: {
      descriptorTotal: results.length,
      ...counts,
      warnings: warnings.length,
      ...(strict ? { strictFailures } : {}),
    },
    descriptorIssues,
    warnings,
  };
}
