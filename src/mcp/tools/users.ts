// User-management tools.
//
// Note: this module owns the get_users and update_user_rights handlers
// only. Schemas stay inline in handleListTools because they are not
// adjacent in the legacy tools/list ordering (update_user_rights sits
// between get_energy_data and the globals cluster, get_users is a
// singleton between the globals cluster and snapshot). Order is preserved
// byte-for-byte in tools/list.

import { ToolModule } from './registry';
import { deepMerge, deepEqual } from '../util';

export const users: ToolModule = {
  schemas: [],

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
