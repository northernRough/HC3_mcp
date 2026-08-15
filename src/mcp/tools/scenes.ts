// Scene tools (run, modify, create, content updates).

import { ToolModule } from './registry';
import { verifyWrite, contentHash } from '../util';
import { applyEdits, unifiedDiff, excerpt, wantsExcerpt, PatchEdit } from '../patch';
import { luaLint, luaWarningSummary, toLuaSource } from '../lua';

/**
 * HC3 stores `conditions` and `actions` as Lua SOURCE STRINGS. A structured
 * value in either slot is accepted by the REST layer, stored, and then killed
 * by HC3's own Lua engine at subscribe time:
 *
 *   400 SceneValidationError
 *   engine.lua:623: attempt to concatenate a table value (field 'conditions')
 *
 * Which names a line number in Fibaro's engine and not the argument at fault.
 * Reproduced against 5.2x: an object in `conditions` fails exactly so, the same
 * scene with a Lua source string is accepted. It reached live telemetry because
 * the mistake is the natural one — every conditions example in circulation is a
 * TABLE, and passing that table as JSON looks equivalent.
 *
 * The refusal carries the Lua the caller almost certainly meant. It does not
 * convert on their behalf: a scene that validates but behaves subtly
 * differently is worse than a refusal on a live controller.
 */
function assertLuaSourceBlock(tool: string, field: 'conditions' | 'actions', value: unknown): void {
  if (value === undefined || value === null || typeof value === 'string') return;
  const rendered = toLuaSource(value);
  throw new Error(
    `${tool}: \`${field}\` must be a Lua source STRING, not a ${Array.isArray(value) ? 'array' : typeof value}. ` +
    `HC3 would store it and then fail at subscribe time with ` +
    `"attempt to concatenate a table value (field '${field}')", which names a line in Fibaro's engine rather than this argument. ` +
    `Send this instead:\n\n${rendered}\n\n` +
    `(as a string — the Lua table is the VALUE of ${field}, not a JSON object in its place).`
  );
}

/** Validate the two Lua blocks inside a `content` argument, in either accepted form. */
function assertSceneContentBlocks(tool: string, content: unknown): void {
  let obj: any = content;
  if (typeof content === 'string') {
    // A JSON string is the other way in, and the one live telemetry arrived by.
    try { obj = JSON.parse(content); } catch { return; }   // plain Lua/scenario body, nothing to check
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  assertLuaSourceBlock(tool, 'conditions', obj.conditions);
  assertLuaSourceBlock(tool, 'actions', obj.actions);
}

/**
 * A lua scene's `content` is a JSON string holding {conditions, actions} —
 * JSON inside JSON, so reaching the Lua takes two parses. Callers should not
 * have to know that, so every scene tool here goes through this.
 */
function parseSceneContent(content: unknown): { conditions: string; actions: string } {
  try {
    const parsed = JSON.parse(typeof content === 'string' ? content : '{}');
    return {
      conditions: typeof parsed.conditions === 'string' ? parsed.conditions : '',
      actions: typeof parsed.actions === 'string' ? parsed.actions : '',
    };
  } catch {
    return { conditions: '', actions: '' };
  }
}

export const scenes: ToolModule = {
  schemas: [
      {
        name: 'get_scenes',
        description: 'Get all scenes from Fibaro HC3, with optional filtering by room',
        inputSchema: {
          type: 'object',
          properties: {
            roomId: {
              type: 'number',
              description: 'Optional: Filter scenes by room ID',
            },
            alexaProhibited: {
              type: 'boolean',
              description: 'Optional: Filter scenes by Alexa prohibition status',
            },
          },
        },
      },
      {
        name: 'get_scene',
        description: 'Fetch a single scene by id via GET /api/scenes/{id}. Returns the full scene record — metadata (name, type, roomId, mode, enabled, isRunning, created/updated, …) plus the complete `content`. Use this to inspect ONE scene: get_scenes returns every scene with its full content and can be very large (easily >1MB).\n\nAlways returns `contentHash` (md5 of what HC3 stored) — pass it to patch_scene_content as expectedHash so the write refuses if the scene changed in between. `contentHash` is returned even when the body is not.\n\n**Getting at the Lua without two JSON parses.** For a lua scene, `content` is a JSON string holding {conditions, actions}, so reaching the source normally means parsing twice. Set block="actions" (or "conditions") and the parsed Lua comes back directly as `block`/`blockContent`, no second parse.\n\n**Reading part of it.** Scene bodies here run to 75 KB. includeContent=false gives metadata plus contentLength only. startLine/endLine or `contains` return a line-numbered excerpt — of the chosen block when `block` is set, otherwise of the raw content — with totalLines so you know what you did not see. Those line numbers quote straight back into a patch_scene_content `old`.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'The scene id to fetch (from get_scenes).',
            },
            includeContent: {
              type: 'boolean',
              description: 'Include the full `content` body (Lua/scenario). Default true. Set false to strip a potentially large content body and return metadata only.',
            },
            block: {
              type: 'string',
              enum: ['actions', 'conditions'],
              description: 'Lua scenes only. Return this block of the parsed content directly instead of the raw JSON-in-JSON `content` string.',
            },
            startLine: {
              type: 'number',
              description: '1-indexed first line to return.',
            },
            endLine: {
              type: 'number',
              description: '1-indexed last line to return (inclusive).',
            },
            contains: {
              type: 'string',
              description: 'Return only lines containing this literal substring, with context either side. Case-sensitive, not a regex.',
            },
            contextLines: {
              type: 'number',
              description: 'Lines of context either side of a `contains` hit. Default 3.',
            },
            maxLines: {
              type: 'number',
              description: 'Cap on returned lines. Default 200.',
            },
          },
          required: ['sceneId'],
        },
      },
      {
        name: 'run_scene',
        description: 'Execute a scene by ID',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
          },
          required: ['sceneId'],
        },
      },
      {
        name: 'stop_scene',
        description: 'Stop a running scene by ID',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
          },
          required: ['sceneId'],
        },
      },
      {
        name: 'run_scene_sync',
        description: 'Run a scene synchronously via POST /api/scenes/{id}/executeSync. Unlike run_scene (fires async and returns immediately), this waits until the scene has finished running before returning. Useful for sequencing dependent automation steps. Returns HC3\'s response (204 No Content on success — no return payload).',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: { type: 'number', description: 'Scene ID' }
          },
          required: ['sceneId']
        }
      },
      {
        name: 'modify_scene',
        description: 'Modify top-level scene metadata (name, enabled, maxRunningInstances, restart, hidden, stopOnAlarm, protectedByPin, mode, roomId, icon, description, categories). Does not modify scene content (conditions/actions) — use update_scene_content for that.\n\n**`restart` is the concurrency control.** A scene runs one instance at a time; `restart: true` means an incoming trigger kills the running instance, `false` means the running instance is protected and the trigger is dropped. **`maxRunningInstances` is vestigial** — an HC2 leftover that reads a constant 2 on every scene and is not exposed in the HC3 UI. It is accepted here because HC3 accepts it, but writing it does nothing; do not design around it.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
            properties: {
              type: 'object',
              description: 'Scene fields to update. Any subset of the fields below is accepted; fields not supplied are left unchanged.',
              properties: {
                name: { type: 'string' },
                enabled: { type: 'boolean' },
                maxRunningInstances: { type: 'number' },
                restart: { type: 'boolean' },
                hidden: { type: 'boolean' },
                stopOnAlarm: { type: 'boolean' },
                protectedByPin: { type: 'boolean' },
                mode: { type: 'string', enum: ['automatic', 'manual'] },
                roomId: { type: 'number' },
                icon: { type: 'string' },
                description: { type: 'string' },
                categories: { type: 'array', items: { type: 'number' } },
              },
              additionalProperties: false,
            },
          },
          required: ['sceneId', 'properties'],
        },
      },
      {
        name: 'create_scene',
        description: 'Create a new scene via POST /api/scenes. Post-create verify: refetches /api/scenes/{newId} and confirms name + type match. Guards: name must be 1–50 chars (HC3 silently truncates / rejects otherwise); type must be "lua" or "scenario". **`content` is {conditions, actions}, and BOTH are Lua source STRINGS.** The conditions block is a Lua table written as text, e.g. `"{ conditions = { { id = 2699, isTrigger = true, operator = \\"==\\", property = \\"value\\", type = \\"device\\", value = false } }, operator = \\"any\\" }"` — not a JSON object in its place. Passing the structure directly is refused here, because HC3 accepts it, stores it, and then dies at subscribe time with `attempt to concatenate a table value (field \'conditions\')`, naming a line in Fibaro\'s engine rather than your argument. The refusal prints the Lua to send instead. If content is an object it is JSON.stringify\'d before sending (matches update_scene_content semantics).\n\n**Before writing the Lua, call get_hc3_lua_scenes_guide({topic:"execution_model"}).** Most scene advice in circulation is HC2 advice or one of two myths, and both change what you write here: a scene runs ONE instance, governed by the `restart` field (`maxRunningInstances` is vestigial — never write it), and a firing `fibaro.setTimeout` does NOT restart the scene, so closures survive and the defensive re-read-everything pattern is a durability choice rather than a requirement (verified here on scratch scenes: a control arm with no timer scored one top-of-scene execution, the timer arm scored one with its callback firing, and a captured local survived intact). The guide also covers the conditions table, `matchInterval` for periodic scenes, and why state you may need to inspect belongs in a QuickApp.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Scene name (1–50 chars).' },
            type: { type: 'string', enum: ['lua', 'scenario'], description: 'Scene type.' },
            roomId: { type: 'number', description: 'Room id (required). Use get_rooms to find a valid id — HC3 rejects roomId=0 on creation.' },
            content: { description: 'Scene body. Either a JSON string or an object of the shape {conditions, actions} — an object is JSON.stringify\'d. Both blocks must be Lua SOURCE STRINGS; a structured value in either is refused, with the correct Lua printed in the error.' },
            maxRunningInstances: { type: 'number', description: 'Default 1.' },
            enabled: { type: 'boolean', description: 'Default true.' },
            hidden: { type: 'boolean', description: 'Default false.' },
            icon: { type: 'string', description: 'Icon id. Default "scene_icon_icon_scene1".' },
            categories: { type: 'array', items: { type: 'number' }, description: 'Category ids (HC3 rejects empty). Defaults to [1].' }
          },
          required: ['name', 'type', 'roomId']
        }
      },
      {
        name: 'delete_scene',
        description: 'Delete a scene by id via DELETE /api/scenes/{id}. Reads the scene first to capture name/type/content as a recovery trail in the response. Refuses to delete a scene that is currently running (isRunning=true) — stop_scene first. Post-delete verifies by refetch (expects HTTP 404). Returns {sceneId, deletedScene} where deletedScene is the last-known-good record. The MCP previously had no delete_scene tool, forcing the test harness to use a raw REST DELETE workaround; this fills that gap.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
          },
          required: ['sceneId'],
        },
      },
      {
        name: 'update_scene_content',
        description: 'Update the Lua content (actions and/or conditions) of a Lua-type scene. If only one of actions/conditions is supplied, the other is preserved.\n\n**Response size.** This tool used to return the previous body, the current body AND the full scene record — three copies of a body that is routinely 75 KB on a real scene, so a one-line change cost ~225 KB of response. It now returns lengths and md5 hashes instead, and strips `content` from the scene record. Set returnContent=true to get the bodies back (the old shape) when you specifically want a last-known-good copy inline; otherwise read the scene before writing if you need one, because this tool no longer hands you one by default.\n\nWriting scene Lua from scratch or reworking control flow? get_hc3_lua_scenes_guide({topic:"execution_model"}) first — one instance governed by `restart`, and a firing `fibaro.setTimeout` does not restart the scene or lose its closure, which is the opposite of what most forum advice says.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
            actions: {
              type: 'string',
              description: 'Lua source for the scene actions block. If omitted, existing actions are preserved.',
            },
            conditions: {
              type: 'string',
              description: 'Conditions block source (Lua table as a string). If omitted, existing conditions are preserved. Only valid for Lua-type scenes.',
            },
            returnContent: {
              type: 'boolean',
              description: 'Return the full previous/current bodies and the untrimmed scene record (pre-4.18 shape). Default false. On a large scene this multiplies the response by roughly three times the body size.',
            },
          },
          required: ['sceneId'],
        },
      },
      {
        name: 'patch_scene_content',
        description: 'Change part of a Lua scene by supplying only the text to replace, instead of reproducing the whole body as update_scene_content requires. Same semantics as patch_quickapp_file, and scenes need it more: a QuickApp can be split across files to keep edits small, but a scene is one monolithic block with no equivalent escape hatch, so every scene edit otherwise pays the full cost. Bodies here run to 75 KB.\n\n**Each `old` must match exactly `count` times (default 1), or NOTHING is written** — not the failing edit and not the edits before it. `old` is literal text, never a regex or a line number, and must match byte for byte. Set `new` to an empty string to delete. Edits apply in order, each against the result of the previous one.\n\nPatches `actions` by default; set block="conditions" for the other. The block you do not touch is preserved exactly.\n\nAtomic: edits apply to an in-memory copy, the scene is written once, then re-fetched and compared. Returns a unified diff, sizes and an md5 — not the body. dryRun=true returns that diff with no write, which matters more here than on a QuickApp: **a scene that will not compile fails silently.** It sits inert until its trigger fires, potentially hours later, with nothing to distinguish it from a trigger that never fired. The patched result is checked for gross Lua damage and reported as `luaWarnings` — a heuristic, not a parser, so it warns and still writes.\n\nIf the scene is running when patched, the response reports `sceneWasRunning` so a write landing mid-run is at least visible. What HC3 does to an in-flight scene whose source changes underneath it has not been isolated on this gateway, so the flag states the fact and claims nothing further.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
            block: {
              type: 'string',
              enum: ['actions', 'conditions'],
              description: 'Which block to patch. Default "actions".',
            },
            edits: {
              type: 'array',
              description: 'Edits to apply, in order. At least one.',
              items: {
                type: 'object',
                properties: {
                  old: {
                    type: 'string',
                    description: 'Exact existing text to replace. Literal, not a pattern; must match byte for byte including indentation. Cannot be empty.',
                  },
                  new: {
                    type: 'string',
                    description: 'Replacement text. Empty string deletes the matched text.',
                  },
                  count: {
                    type: 'number',
                    description: 'Exact number of occurrences expected. Default 1. Any other number aborts the whole patch before anything is written.',
                  },
                },
                required: ['old', 'new'],
              },
            },
            expectedHash: {
              type: 'string',
              description: 'The contentHash from get_scene. If supplied and the scene no longer hashes to it, the patch is refused without writing. A scene can also be edited from the web UI or the mobile app, so there is no single writer.',
            },
            dryRun: {
              type: 'boolean',
              description: 'Compute and return the diff without writing anything. Default false.',
            },
          },
          required: ['sceneId', 'edits'],
        },
      },
  ],

  handlers: {
    async get_scenes(hc3, args: { roomId?: number; alexaProhibited?: boolean }): Promise<any> {
      let endpoint = '/api/scenes';
      const queryParams: string[] = [];

      if (args?.alexaProhibited !== undefined) {
        queryParams.push(`alexaProhibited=${args.alexaProhibited}`);
      }

      if (queryParams.length > 0) {
        endpoint += `?${queryParams.join('&')}`;
      }

      const scenes = await hc3.request(endpoint);

      if (args?.roomId) {
        return scenes.filter((scene: any) => scene.roomID === args.roomId);
      }

      return scenes;
    },

    async get_scene(hc3, args: {
      sceneId: number;
      includeContent?: boolean;
      block?: 'actions' | 'conditions';
      startLine?: number;
      endLine?: number;
      contains?: string;
      contextLines?: number;
      maxLines?: number;
    }): Promise<any> {
      if (typeof args?.sceneId !== 'number') {
        throw new Error('get_scene requires a numeric sceneId.');
      }
      if (args.block !== undefined && args.block !== 'actions' && args.block !== 'conditions') {
        throw new Error(`get_scene: block must be "actions" or "conditions" (got ${JSON.stringify(args.block)}).`);
      }
      const scene = await hc3.request(`/api/scenes/${args.sceneId}`);
      if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return scene;

      const { content, ...rest } = scene as Record<string, any>;
      const hash = contentHash(content);
      const meta = {
        ...rest,
        ...(hash ? { contentHash: hash } : {}),
        contentLength: typeof content === 'string' ? content.length : undefined,
      };

      // Metadata only.
      if (args.includeContent === false) {
        return { ...meta, contentOmitted: true };
      }

      // A named block: hand back the parsed Lua rather than JSON inside JSON.
      if (args.block !== undefined) {
        if (rest.type !== 'lua') {
          throw new Error(
            `get_scene: block="${args.block}" is for lua scenes; scene ${args.sceneId} is type '${rest.type}'. ` +
            `Omit block to get the raw content.`
          );
        }
        const parsed = parseSceneContent(content);
        const body = parsed[args.block];
        if (wantsExcerpt(args)) {
          return { ...meta, contentOmitted: true, block: args.block, blockLength: body.length, ...excerpt(body, args) };
        }
        return { ...meta, contentOmitted: true, block: args.block, blockLength: body.length, blockContent: body };
      }

      if (wantsExcerpt(args) && typeof content === 'string') {
        return { ...meta, contentOmitted: true, ...excerpt(content, args) };
      }

      return { ...rest, content, ...(hash ? { contentHash: hash } : {}) };
    },

    async run_scene(hc3, args: { sceneId: number }): Promise<any> {
      await hc3.request(`/api/scenes/${args.sceneId}/execute`, 'POST', {});
      return `Scene ${args.sceneId} started successfully.`;
    },

    async stop_scene(hc3, args: { sceneId: number }): Promise<any> {
      await hc3.request(`/api/scenes/${args.sceneId}/kill`, 'POST', {});
      return `Scene ${args.sceneId} stopped successfully.`;
    },

    async run_scene_sync(hc3, args: { sceneId: number }): Promise<any> {
      if (typeof args?.sceneId !== 'number') {
        throw new Error('run_scene_sync requires numeric sceneId.');
      }
      const started = Date.now();
      await hc3.request(`/api/scenes/${args.sceneId}/executeSync`, 'POST', {});
      return {
        sceneId: args.sceneId,
        mode: 'sync',
        elapsedMs: Date.now() - started
      };
    },

    async modify_scene(hc3, args: { sceneId: number; properties: Record<string, any> }): Promise<any> {
      if (!args?.properties || Object.keys(args.properties).length === 0) {
        throw new Error('modify_scene requires at least one field in properties.');
      }
      await hc3.request(`/api/scenes/${args.sceneId}`, 'PUT', args.properties);
      const updated = await hc3.request(`/api/scenes/${args.sceneId}`);
      verifyWrite(args.properties, undefined, updated, `scene ${args.sceneId}`);
      return {
        sceneId: args.sceneId,
        changedFields: Object.keys(args.properties),
        scene: updated,
      };
    },

    async create_scene(hc3, args: {
      name: string;
      type: string;
      roomId?: number;
      content?: any;
      maxRunningInstances?: number;
      enabled?: boolean;
      hidden?: boolean;
      icon?: string;
      categories?: number[];
    }): Promise<any> {
      if (!args?.name) throw new Error('create_scene requires name.');
      if (args.name.length < 1 || args.name.length > 50) {
        throw new Error(`create_scene: name must be 1–50 characters (got ${args.name.length}).`);
      }
      if (args.type !== 'lua' && args.type !== 'scenario') {
        throw new Error(`create_scene: type must be "lua" or "scenario" (got ${JSON.stringify(args.type)}).`);
      }
      if (typeof args.roomId !== 'number') {
        throw new Error('create_scene: roomId is required and must be a valid room id (HC3 rejects roomId=0 on creation).');
      }
      const body: Record<string, any> = {
        name: args.name,
        type: args.type,
        mode: 'automatic',
        roomId: args.roomId,
        maxRunningInstances: args.maxRunningInstances ?? 1,
        enabled: args.enabled !== false,
        hidden: !!args.hidden,
        icon: args.icon ?? 'scene_icon_icon_scene1',
        restart: true,
        protectedByPin: false,
        stopOnAlarm: false,
        categories: args.categories && args.categories.length > 0 ? args.categories : [1]
      };
      if (args.content !== undefined) {
        assertSceneContentBlocks('create_scene', args.content);
        body.content = typeof args.content === 'string' ? args.content : JSON.stringify(args.content);
      }
      const created: any = await hc3.request('/api/scenes', 'POST', body);
      const newId = created?.id;
      if (typeof newId !== 'number') {
        throw new Error(`create_scene: HC3 returned no id. Raw: ${JSON.stringify(created).slice(0, 300)}`);
      }
      const after: any = await hc3.request(`/api/scenes/${newId}`);
      if (after?.name !== args.name) {
        throw new Error(`create_scene: post-create name mismatch. Submitted ${JSON.stringify(args.name)}, stored ${JSON.stringify(after?.name)}.`);
      }
      if (after?.type !== args.type) {
        throw new Error(`create_scene: post-create type mismatch. Submitted ${JSON.stringify(args.type)}, stored ${JSON.stringify(after?.type)}.`);
      }
      return { sceneId: newId, scene: after };
    },

    async delete_scene(hc3, args: { sceneId: number }): Promise<any> {
      if (typeof args?.sceneId !== 'number') {
        throw new Error('delete_scene requires numeric sceneId.');
      }
      const scene: any = await hc3.request(`/api/scenes/${args.sceneId}`);
      if (scene?.isRunning) {
        throw new Error(
          `delete_scene refuses scene ${args.sceneId} (${scene.name}): scene is currently running. ` +
          `Call stop_scene first.`
        );
      }
      await hc3.request(`/api/scenes/${args.sceneId}`, 'DELETE');
      try {
        await hc3.request(`/api/scenes/${args.sceneId}`);
        throw new Error(
          `delete_scene: post-delete verify failed — scene ${args.sceneId} still exists after DELETE.`
        );
      } catch (e: any) {
        if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
      }
      return {
        sceneId: args.sceneId,
        deletedScene: {
          id: scene.id,
          name: scene.name,
          type: scene.type,
          roomId: scene.roomId,
          enabled: scene.enabled,
          content: scene.content,
        },
      };
    },

    async patch_scene_content(hc3, args: {
      sceneId: number;
      block?: 'actions' | 'conditions';
      edits: PatchEdit[];
      expectedHash?: string;
      dryRun?: boolean;
    }): Promise<any> {
      const { sceneId, edits, expectedHash, dryRun } = args ?? ({} as any);
      const block = args?.block ?? 'actions';
      if (typeof sceneId !== 'number') {
        throw new Error('patch_scene_content requires a numeric sceneId.');
      }
      if (block !== 'actions' && block !== 'conditions') {
        throw new Error(`patch_scene_content: block must be "actions" or "conditions" (got ${JSON.stringify(args?.block)}).`);
      }

      const existing: any = await hc3.request(`/api/scenes/${sceneId}`);
      if (existing?.type !== 'lua') {
        throw new Error(
          `patch_scene_content: scene ${sceneId} is type '${existing?.type}'; this tool supports Lua scenes only. ` +
          `Scenario scenes use structured JSON and would be corrupted by a text patch.`
        );
      }

      const hashBefore = contentHash(existing?.content);
      if (expectedHash !== undefined && expectedHash !== hashBefore) {
        throw new Error(
          `patch_scene_content refused: scene ${sceneId} has changed since you read it. ` +
          `Expected md5 ${expectedHash}, found ${hashBefore}. Nothing was written. ` +
          `Re-read it (get_scene) and rebuild the edits against the current content.`
        );
      }

      const previous = parseSceneContent(existing?.content);
      const before = previous[block];

      // Throws before any write if an edit does not fit.
      const { content: after, applied } = applyEdits(before, edits, 'patch_scene_content');
      const luaWarnings = luaWarningSummary(luaLint(after));

      const diff = unifiedDiff(before, after, {
        fromLabel: `scene ${sceneId} ${block} (before)`,
        toLabel: `scene ${sceneId} ${block} (after)`,
      });

      const base = {
        target: `scene:${sceneId}/${block}`,
        block,
        occurrencesReplaced: applied.reduce((n, e) => n + e.occurrences, 0),
        bytesBefore: before.length,
        bytesAfter: after.length,
        sceneWasRunning: !!existing?.isRunning,
        hashBefore,
        ...(luaWarnings ? { luaWarnings } : {}),
        diff,
      };

      if (dryRun === true) {
        return {
          ...base,
          dryRun: true,
          written: false,
          editsMatched: applied.length,
          hashWouldBe: contentHash(JSON.stringify({
            conditions: block === 'conditions' ? after : previous.conditions,
            actions: block === 'actions' ? after : previous.actions,
          })),
        };
      }

      const newContent = {
        conditions: block === 'conditions' ? after : previous.conditions,
        actions: block === 'actions' ? after : previous.actions,
      };
      await hc3.request(`/api/scenes/${sceneId}`, 'PUT', { content: JSON.stringify(newContent) });

      const updated: any = await hc3.request(`/api/scenes/${sceneId}`);
      const current = parseSceneContent(updated?.content);
      if (current[block] !== after) {
        throw new Error(
          `patch_scene_content: content mismatch after PUT on scene ${sceneId}. ` +
          `Submitted ${after.length} chars for '${block}', HC3 stored ${current[block].length}. ` +
          `The write was silently altered or dropped — re-read the scene before patching again.`
        );
      }
      const untouched = block === 'actions' ? 'conditions' : 'actions';
      if (current[untouched] !== previous[untouched]) {
        throw new Error(
          `patch_scene_content: the '${untouched}' block changed although it was not patched ` +
          `(${previous[untouched].length} chars before, ${current[untouched].length} after). ` +
          `Re-read scene ${sceneId} and check it.`
        );
      }

      return {
        ...base,
        written: true,
        editsApplied: applied.length,
        hashAfter: contentHash(updated?.content),
      };
    },

    async update_scene_content(hc3, args: { sceneId: number; actions?: string; conditions?: string; returnContent?: boolean }): Promise<any> {
      assertLuaSourceBlock('update_scene_content', 'conditions', args.conditions);
      assertLuaSourceBlock('update_scene_content', 'actions', args.actions);
      if (args.actions === undefined && args.conditions === undefined) {
        throw new Error('update_scene_content requires at least one of actions or conditions.');
      }

      const existing = await hc3.request(`/api/scenes/${args.sceneId}`);

      if (existing.type !== 'lua') {
        throw new Error(
          `Scene ${args.sceneId} is type '${existing.type}'; this tool supports Lua scenes only. ` +
          `Scenario scenes use structured JSON for conditions and would be corrupted by this tool.`
        );
      }

      const previous = parseSceneContent(existing.content);

      const newContent = {
        conditions: args.conditions !== undefined ? args.conditions : previous.conditions,
        actions: args.actions !== undefined ? args.actions : previous.actions,
      };

      await hc3.request(`/api/scenes/${args.sceneId}`, 'PUT', { content: JSON.stringify(newContent) });
      const updated = await hc3.request(`/api/scenes/${args.sceneId}`);

      const current = parseSceneContent(updated.content);

      const changedFields: string[] = [];
      if (args.conditions !== undefined) changedFields.push('conditions');
      if (args.actions !== undefined) changedFields.push('actions');

      if (args.returnContent === true) {
        return {
          sceneId: args.sceneId,
          changedFields,
          previous,
          current,
          scene: updated,
        };
      }

      // Default: describe the bodies rather than repeating them. Hash the raw
      // `content` string as HC3 stored it, so the value is comparable against
      // a later re-fetch.
      const { content: updatedContent, ...sceneWithoutContent } = (updated ?? {}) as Record<string, any>;
      return {
        sceneId: args.sceneId,
        changedFields,
        previous: {
          conditionsLength: previous.conditions.length,
          actionsLength: previous.actions.length,
          contentHash: contentHash(existing?.content),
        },
        current: {
          conditionsLength: current.conditions.length,
          actionsLength: current.actions.length,
          contentHash: contentHash(updatedContent),
        },
        scene: {
          ...sceneWithoutContent,
          contentOmitted: true,
          contentLength: typeof updatedContent === 'string' ? updatedContent.length : undefined,
        },
        hint: 'Bodies omitted to keep the response small. Pass returnContent=true for the full previous/current text, or get_scene for the stored source.',
      };
    },
  },
};
