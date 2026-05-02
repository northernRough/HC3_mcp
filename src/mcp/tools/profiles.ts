// Profile orchestration tools (Home/Away/Vacation/Night modes plus the
// per-profile association PUTs for scenes/climateZones/partitions).

import { ToolModule } from './registry';
import { deepEqual, deepMerge, verifyWrite } from '../util';

export const profiles: ToolModule = {
  schemas: [
      {
        name: 'get_profiles',
        description: 'List all HC3 profiles plus the activeProfile id. Profiles group scenes/climateZones/partitions/devices into mode-based orchestrations (Home/Away/Vacation/Night). Wraps GET /api/profiles.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_profile',
        description: 'Get a single profile by id. Wraps GET /api/profiles/{id}.',
        inputSchema: {
          type: 'object',
          properties: { profileId: { type: 'number', description: 'Profile id' } },
          required: ['profileId']
        }
      },
      {
        name: 'activate_profile',
        description: 'Switch the active profile via POST /api/profiles/activeProfile/{id}. Triggers HC3\'s profile-activation cascade: scenes listed as "kill on activate" are killed, scenes listed as "run on activate" are run, etc. Post-activation verifies by refetching /api/profiles and confirming activeProfile has changed. Use this as the agent-level equivalent of tapping a mode button in the HC3 mobile app.',
        inputSchema: {
          type: 'object',
          properties: { profileId: { type: 'number', description: 'Profile id to activate' } },
          required: ['profileId']
        }
      },
      {
        name: 'modify_profile',
        description: 'Modify a profile\'s configuration (name, iconId, or the devices / scenes / climateZones / partitions arrays that define what the profile orchestrates). Follows the standard read-modify-write + post-write-verify pattern: reads current, deep-merges submitted fields, PUTs, refetches, asserts merge result matches. Wraps PUT /api/profiles/{id}.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id to modify' },
            fields: {
              type: 'object',
              description: 'Partial update. Any of: name (string), iconId (number), devices (array), scenes (array), climateZones (array), partitions (array). Array fields fully replace — HC3 PUT semantics on array-valued properties.'
            }
          },
          required: ['profileId', 'fields']
        }
      },
      {
        name: 'create_profile',
        description: 'Create a new HC3 profile via POST /api/profiles. Post-create verify: refetches the profile and confirms the name matches. Returns the HC3-assigned profileId.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display name for the new profile.' },
            iconId: { type: 'number', description: 'Optional icon id (HC3 profile icon catalogue).' }
          },
          required: ['name']
        }
      },
      {
        name: 'delete_profile',
        description: 'Delete a profile via DELETE /api/profiles/{id}. Guards: refuses if the profile is the currently active one (you cannot delete the active profile without switching first). Post-delete verifies by refetch expecting 404.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id to delete' }
          },
          required: ['profileId']
        }
      },
      {
        name: 'reset_profiles',
        description: 'DESTRUCTIVE: reset all profiles to HC3 defaults via POST /api/profiles/reset. Wipes all custom profile configuration (device lists, scene actions, climate-zone actions, partition actions) across every profile. Requires confirm=true. No undo.',
        inputSchema: {
          type: 'object',
          properties: {
            confirm: { type: 'boolean', description: 'Must be true to proceed. Any other value refuses.' }
          },
          required: ['confirm']
        }
      },
      {
        name: 'set_profile_scene_action',
        description: 'Set how a profile handles a specific scene when activated. Wraps PUT /api/profiles/{profileId}/scenes/{sceneId}. Body: {actions: [...]} where actions is an array of scene-action strings (e.g. ["execute"], ["kill"], ["setToAuto"]). The scene must already be present in the profile\'s scenes array (use modify_profile to add first).',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id' },
            sceneId: { type: 'number', description: 'Scene id within the profile' },
            actions: { type: 'array', items: { type: 'string' }, description: 'Action strings. Examples: "execute", "kill", "setToAuto".' }
          },
          required: ['profileId', 'sceneId', 'actions']
        }
      },
      {
        name: 'set_profile_climate_zone_action',
        description: 'Set how a profile handles a specific climate zone when activated. Wraps PUT /api/profiles/{profileId}/climateZones/{zoneId}. Body: {mode, properties}. Mode values observed: "Manual", "Auto", others per firmware. Properties vary by mode (e.g. handMode="Heat", handSetPointHeating=21 for Manual).',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id' },
            zoneId: { type: 'number', description: 'Climate zone id' },
            mode: { type: 'string', description: 'Mode (e.g. Manual, Auto).' },
            properties: { type: 'object', description: 'Mode-specific properties (e.g. {handMode, handSetPointHeating}).' }
          },
          required: ['profileId', 'zoneId', 'mode']
        }
      },
      {
        name: 'set_profile_partition_action',
        description: 'Set how a profile handles a specific alarm partition when activated. Wraps PUT /api/profiles/{profileId}/partitions/{partitionId}. Body: {action} where action is typically "arm", "disarm", or null.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id' },
            partitionId: { type: 'number', description: 'Alarm partition id' },
            action: { type: ['string', 'null'], description: 'Partition action (e.g. "arm", "disarm") or null for no-op.' }
          },
          required: ['profileId', 'partitionId']
        }
      },
  ],

  handlers: {
    async get_profiles(hc3): Promise<any> {
      return await hc3.request('/api/profiles');
    },

    async get_profile(hc3, args: { profileId: number }): Promise<any> {
      if (typeof args?.profileId !== 'number') {
        throw new Error('get_profile requires numeric profileId.');
      }
      return await hc3.request(`/api/profiles/${args.profileId}`);
    },

    async activate_profile(hc3, args: { profileId: number }): Promise<any> {
      if (typeof args?.profileId !== 'number') {
        throw new Error('activate_profile requires numeric profileId.');
      }
      const before: any = await hc3.request('/api/profiles');
      const profile = (before?.profiles ?? []).find((p: any) => p.id === args.profileId);
      if (!profile) {
        throw new Error(`activate_profile: profile ${args.profileId} not found.`);
      }
      await hc3.request(`/api/profiles/activeProfile/${args.profileId}`, 'POST', {});
      const after: any = await hc3.request('/api/profiles');
      if (after?.activeProfile !== args.profileId) {
        throw new Error(
          `activate_profile: post-activation verify failed. Submitted activeProfile=${args.profileId}, HC3 reports activeProfile=${after?.activeProfile}.`
        );
      }
      return {
        activated: args.profileId,
        name: profile.name,
        previousActive: before?.activeProfile
      };
    },

    async modify_profile(hc3, args: {
      profileId: number;
      fields: Record<string, any>;
    }): Promise<any> {
      if (typeof args?.profileId !== 'number') {
        throw new Error('modify_profile requires numeric profileId.');
      }
      if (!args?.fields || typeof args.fields !== 'object' || Array.isArray(args.fields) || Object.keys(args.fields).length === 0) {
        throw new Error('modify_profile requires a non-empty fields object.');
      }
      const current: any = await hc3.request(`/api/profiles/${args.profileId}`);
      const merged = deepMerge(current, args.fields);
      await hc3.request(`/api/profiles/${args.profileId}`, 'PUT', merged);
      const after: any = await hc3.request(`/api/profiles/${args.profileId}`);
      verifyWrite(args.fields, undefined, after, `profile ${args.profileId}`);
      return {
        profileId: args.profileId,
        changedFields: Object.keys(args.fields),
        profile: after
      };
    },

    async create_profile(hc3, args: { name: string; iconId?: number }): Promise<any> {
      if (!args?.name) throw new Error('create_profile requires name.');
      const body: Record<string, any> = { name: args.name };
      if (args.iconId !== undefined) body.iconId = args.iconId;
      const created: any = await hc3.request('/api/profiles', 'POST', body);
      const newId = created?.id;
      if (typeof newId !== 'number') {
        throw new Error(`create_profile: HC3 returned no id. Raw: ${JSON.stringify(created).slice(0, 300)}`);
      }
      const after: any = await hc3.request(`/api/profiles/${newId}`);
      if (after?.name !== args.name) {
        throw new Error(`create_profile: post-create name mismatch. Submitted ${JSON.stringify(args.name)}, stored ${JSON.stringify(after?.name)}.`);
      }
      return { profileId: newId, profile: after };
    },

    async delete_profile(hc3, args: { profileId: number }): Promise<any> {
      if (typeof args?.profileId !== 'number') throw new Error('delete_profile requires numeric profileId.');
      const list: any = await hc3.request('/api/profiles');
      if (list?.activeProfile === args.profileId) {
        const name = (list.profiles ?? []).find((p: any) => p.id === args.profileId)?.name ?? '?';
        throw new Error(
          `delete_profile refuses profile ${args.profileId} (${name}): it is the currently active profile. ` +
          `Use activate_profile to switch first, then delete.`
        );
      }
      const existing = (list.profiles ?? []).find((p: any) => p.id === args.profileId);
      if (!existing) {
        throw new Error(`delete_profile: profile ${args.profileId} not found.`);
      }
      await hc3.request(`/api/profiles/${args.profileId}`, 'DELETE');
      try {
        await hc3.request(`/api/profiles/${args.profileId}`);
        throw new Error(`delete_profile: post-delete verify failed — profile ${args.profileId} still exists.`);
      } catch (e: any) {
        if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
      }
      return { deleted: args.profileId, name: existing.name };
    },

    async reset_profiles(hc3, args: { confirm: boolean }): Promise<any> {
      if (args?.confirm !== true) {
        throw new Error(
          'reset_profiles refuses: this DESTROYS all custom profile configuration (device lists, scene actions, climate zone actions, partition actions) across every profile. Pass confirm=true to proceed. No undo.'
        );
      }
      await hc3.request('/api/profiles/reset', 'POST', null);
      return { reset: true, warning: 'All profiles reset to HC3 defaults. Custom configuration erased.' };
    },

    async set_profile_scene_action(hc3, args: {
      profileId: number;
      sceneId: number;
      actions: string[];
    }): Promise<any> {
      if (typeof args?.profileId !== 'number') throw new Error('set_profile_scene_action requires numeric profileId.');
      if (typeof args?.sceneId !== 'number') throw new Error('set_profile_scene_action requires numeric sceneId.');
      if (!Array.isArray(args?.actions)) throw new Error('set_profile_scene_action requires actions array.');
      await hc3.request(
        `/api/profiles/${args.profileId}/scenes/${args.sceneId}`,
        'PUT',
        { actions: args.actions }
      );
      const after: any = await hc3.request(`/api/profiles/${args.profileId}`);
      const entry = (after?.scenes ?? []).find((s: any) => s.sceneId === args.sceneId);
      if (!entry) {
        throw new Error(
          `set_profile_scene_action: post-write verify — scene ${args.sceneId} not found in profile ${args.profileId} after PUT. ` +
          `The scene may need to be added to the profile's scenes array first via modify_profile.`
        );
      }
      if (!deepEqual(entry.actions, args.actions)) {
        throw new Error(
          `set_profile_scene_action: post-write verify failed. Submitted ${JSON.stringify(args.actions)}, stored ${JSON.stringify(entry.actions)}.`
        );
      }
      return { profileId: args.profileId, sceneId: args.sceneId, actions: entry.actions };
    },

    async set_profile_climate_zone_action(hc3, args: {
      profileId: number;
      zoneId: number;
      mode: string;
      properties?: Record<string, any>;
    }): Promise<any> {
      if (typeof args?.profileId !== 'number') throw new Error('set_profile_climate_zone_action requires numeric profileId.');
      if (typeof args?.zoneId !== 'number') throw new Error('set_profile_climate_zone_action requires numeric zoneId.');
      if (typeof args?.mode !== 'string') throw new Error('set_profile_climate_zone_action requires mode.');
      const body: Record<string, any> = { mode: args.mode };
      if (args.properties !== undefined) body.properties = args.properties;
      await hc3.request(
        `/api/profiles/${args.profileId}/climateZones/${args.zoneId}`,
        'PUT',
        body
      );
      const after: any = await hc3.request(`/api/profiles/${args.profileId}`);
      const entry = (after?.climateZones ?? []).find((z: any) => z.id === args.zoneId);
      if (!entry || entry.mode !== args.mode) {
        throw new Error(
          `set_profile_climate_zone_action: post-write verify failed. ` +
          `Stored: ${JSON.stringify(entry ?? null)}. Submitted mode=${JSON.stringify(args.mode)}.`
        );
      }
      return { profileId: args.profileId, zoneId: args.zoneId, mode: entry.mode, properties: entry.properties };
    },

    async set_profile_partition_action(hc3, args: {
      profileId: number;
      partitionId: number;
      action: string | null;
    }): Promise<any> {
      if (typeof args?.profileId !== 'number') throw new Error('set_profile_partition_action requires numeric profileId.');
      if (typeof args?.partitionId !== 'number') throw new Error('set_profile_partition_action requires numeric partitionId.');
      await hc3.request(
        `/api/profiles/${args.profileId}/partitions/${args.partitionId}`,
        'PUT',
        { action: args.action ?? null }
      );
      const after: any = await hc3.request(`/api/profiles/${args.profileId}`);
      const entry = (after?.partitions ?? []).find((p: any) => p.id === args.partitionId);
      if (!entry) {
        throw new Error(
          `set_profile_partition_action: post-write verify — partition ${args.partitionId} not found in profile ${args.profileId}.`
        );
      }
      if (entry.action !== (args.action ?? null)) {
        throw new Error(
          `set_profile_partition_action: post-write verify failed. Submitted ${JSON.stringify(args.action)}, stored ${JSON.stringify(entry.action)}.`
        );
      }
      return { profileId: args.profileId, partitionId: args.partitionId, action: entry.action };
    },
  },
};
