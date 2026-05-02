// User-management tools.
//
// Schemas are exposed as `usersSchemas.update_user_rights` /
// `usersSchemas.get_users` because the legacy tools/list ordering
// places them at non-adjacent positions (update_user_rights between
// get_energy_data and the globals cluster, get_users between globals
// and snapshot). The server references each at its tools/list slot.

import { ToolModule } from './registry';
import { MCPTool } from '../types';
import { deepMerge, deepEqual } from '../util';

export const usersSchemas: Record<string, MCPTool> = {
  update_user_rights:
      {
        name: 'update_user_rights',
        description: 'Update a user\'s access rights (devices / scenes / climateZones / profiles / alarmPartitions) via PUT /api/users/{id}. Follows the standard read-modify-write + post-write-verify pattern: reads the full user record, deep-merges the submitted rights.* subkeys onto the current, and full-array-replaces the leaf arrays (devices, rooms, sections, scenes, zones, etc.) — same HC3 PUT semantics as other array-valued properties. Verifies every submitted array member is present after the write. SAFETY: rejects writes to rights.advanced.* unless allow_advanced_rights=true (17 sensitive subkeys including zWave, backup, access, update — unauthorised access here is a privilege-escalation footgun). Rejects any rights.*.all=true (mass-grant "oops I gave everyone access") unless allow_grant_all=true. Rejects writes targeting superuser-type users (their rights are already all-true by design; any state change there breaks admin access).',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'number',
              description: 'HC3 user id (from get_users). Must be a non-superuser.'
            },
            rights: {
              type: 'object',
              description: 'Partial rights object. Only submitted subkeys are modified; unsubmitted subkeys (scenes, climateZones, etc.) are preserved untouched. Array-valued leaves (rights.devices.devices, rights.devices.rooms, rights.scenes.scenes, etc.) fully replace the current array.'
            },
            allow_advanced_rights: {
              type: 'boolean',
              description: 'Required to write rights.advanced.* (admin / zwave / backup / update / access / alarm / climate etc.). Defaults false.'
            },
            allow_grant_all: {
              type: 'boolean',
              description: 'Required to set rights.<category>.all = true (mass grant). Defaults false.'
            }
          },
          required: ['userId', 'rights']
        }
      },
  get_users:
      {
        name: 'get_users',
        description: 'Get all users configured in the HC3 system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
};

export const users: ToolModule = {
  schemas: Object.values(usersSchemas),

  handlers: {

    async get_users(hc3): Promise<any> {
      return await hc3.request('/api/users');
    },

    async update_user_rights(hc3, args: {
      userId: number;
      rights: Record<string, any>;
      allow_advanced_rights?: boolean;
      allow_grant_all?: boolean;
    }): Promise<any> {
      if (typeof args?.userId !== 'number') {
        throw new Error('update_user_rights requires a numeric userId.');
      }
      if (!args?.rights || typeof args.rights !== 'object' || Array.isArray(args.rights) || Object.keys(args.rights).length === 0) {
        throw new Error('update_user_rights requires a non-empty rights object.');
      }

      if ('advanced' in args.rights && !args.allow_advanced_rights) {
        const advancedKeys = Object.keys(args.rights.advanced || {});
        throw new Error(
          `update_user_rights: writing rights.advanced is a privilege-escalation footgun. ` +
          `Submitted advanced keys: [${advancedKeys.join(', ')}]. ` +
          `Pass allow_advanced_rights=true to override.`
        );
      }

      const grantAllOffences: string[] = [];
      for (const [category, val] of Object.entries(args.rights)) {
        if (val && typeof val === 'object' && !Array.isArray(val) && (val as any).all === true) {
          grantAllOffences.push(`rights.${category}.all=true`);
        }
      }
      if (grantAllOffences.length > 0 && !args.allow_grant_all) {
        throw new Error(
          `update_user_rights: mass-grant write rejected — ${grantAllOffences.join(', ')}. ` +
          `Pass allow_grant_all=true to override.`
        );
      }

      const current: any = await hc3.request(`/api/users/${args.userId}`);
      if (current?.type === 'superuser') {
        throw new Error(
          `update_user_rights: user ${args.userId} (${current.name}) is type 'superuser' — ` +
          `rights are all-true by design. Any state change here could break admin access. Refusing.`
        );
      }

      const currentRights = (current?.rights && typeof current.rights === 'object') ? current.rights : {};
      const mergedRights = deepMerge(currentRights, args.rights);

      // PUT only {rights: ...}, not the full user record. HC3 rejects writes
      // to tosAccepted / privacyPolicyAccepted by anyone other than the user
      // themselves, so a full-record echo-back will 403 with "Terms of service
      // acceptance change forbidden". Partial PUT of just rights is accepted.
      await hc3.request(`/api/users/${args.userId}`, 'PUT', { rights: mergedRights });

      const after: any = await hc3.request(`/api/users/${args.userId}`);
      const afterRights = after?.rights ?? {};

      const mismatches: string[] = [];
      for (const [category, submittedCat] of Object.entries(args.rights)) {
        if (submittedCat === null || typeof submittedCat !== 'object' || Array.isArray(submittedCat)) continue;
        const storedCat = afterRights[category] ?? {};
        for (const [leafKey, submittedLeaf] of Object.entries(submittedCat)) {
          const storedLeaf = storedCat[leafKey];
          if (Array.isArray(submittedLeaf)) {
            const storedArr = Array.isArray(storedLeaf) ? storedLeaf : [];
            const missing = submittedLeaf.filter(v => !storedArr.includes(v));
            const extra = storedArr.filter(v => !submittedLeaf.includes(v));
            if (missing.length > 0 || extra.length > 0) {
              mismatches.push(
                `  - rights.${category}.${leafKey}: submitted ${JSON.stringify(submittedLeaf)}, stored ${JSON.stringify(storedLeaf)}`
              );
            }
          } else if (!deepEqual(submittedLeaf, storedLeaf)) {
            mismatches.push(
              `  - rights.${category}.${leafKey}: submitted ${JSON.stringify(submittedLeaf)}, stored ${JSON.stringify(storedLeaf)}`
            );
          }
        }
      }
      if (mismatches.length > 0) {
        throw new Error(
          `Post-write verification failed for user ${args.userId} (${current.name}).\nMismatched fields:\n${mismatches.join('\n')}\n` +
          `HC3 did not persist the submitted rights as expected.`
        );
      }

      return {
        userId: args.userId,
        name: current.name,
        changedCategories: Object.keys(args.rights),
        rights: afterRights
      };
    },
  },
};
