// Scene tools (run, modify, create, content updates).

import { ToolModule } from './registry';
import { verifyWrite } from '../util';

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
        description: 'Modify top-level scene metadata (name, enabled, maxRunningInstances, restart, hidden, stopOnAlarm, protectedByPin, mode, roomId, icon, description, categories). Does not modify scene content (conditions/actions) — use update_scene_content for that.',
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
        description: 'Create a new scene via POST /api/scenes. Post-create verify: refetches /api/scenes/{newId} and confirms name + type match. Guards: name must be 1–50 chars (HC3 silently truncates / rejects otherwise); type must be "lua" or "scenario". If content is an object it is JSON.stringify\'d before sending (matches update_scene_content semantics).',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Scene name (1–50 chars).' },
            type: { type: 'string', enum: ['lua', 'scenario'], description: 'Scene type.' },
            roomId: { type: 'number', description: 'Room id (required). Use get_rooms to find a valid id — HC3 rejects roomId=0 on creation.' },
            content: { description: 'Scene body. String or object (object is JSON.stringify\'d).' },
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
        name: 'update_scene_content',
        description: 'Update the Lua content (actions and/or conditions) of a Lua-type scene. If only one of actions/conditions is supplied, the other is preserved. Returns both previous and current content so the caller has a last-known-good copy for recovery.',
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
          },
          required: ['sceneId'],
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

    async update_scene_content(hc3, args: { sceneId: number; actions?: string; conditions?: string }): Promise<any> {
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

      let previous: { conditions: string; actions: string } = { conditions: '', actions: '' };
      try {
        const parsed = JSON.parse(existing.content || '{}');
        previous = {
          conditions: typeof parsed.conditions === 'string' ? parsed.conditions : '',
          actions: typeof parsed.actions === 'string' ? parsed.actions : '',
        };
      } catch {
        // leave previous as empty defaults
      }

      const newContent = {
        conditions: args.conditions !== undefined ? args.conditions : previous.conditions,
        actions: args.actions !== undefined ? args.actions : previous.actions,
      };

      await hc3.request(`/api/scenes/${args.sceneId}`, 'PUT', { content: JSON.stringify(newContent) });
      const updated = await hc3.request(`/api/scenes/${args.sceneId}`);

      let current: { conditions: string; actions: string } = { conditions: '', actions: '' };
      try {
        const parsed = JSON.parse(updated.content || '{}');
        current = {
          conditions: typeof parsed.conditions === 'string' ? parsed.conditions : '',
          actions: typeof parsed.actions === 'string' ? parsed.actions : '',
        };
      } catch {
        // leave current as empty defaults
      }

      const changedFields: string[] = [];
      if (args.conditions !== undefined) changedFields.push('conditions');
      if (args.actions !== undefined) changedFields.push('actions');

      return {
        sceneId: args.sceneId,
        changedFields,
        previous,
        current,
        scene: updated,
      };
    },
  },
};
