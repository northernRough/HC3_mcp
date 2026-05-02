// Global-variable tools.
//
// Note: this module owns all four global-variable handlers (get/set/create/
// delete). Three schemas (get/set/create) are exported here; the
// delete_global_variable schema currently sits inline in the legacy
// handleListTools array because tools/list places it in the "delete
// operations" cluster (delete_device, delete_plugin, delete_global_variable
// — all at the array tail). Order is preserved byte-for-byte in tools/list.

import { ToolModule } from './registry';

export const globals: ToolModule = {
  schemas: [
    {
      name: 'get_global_variables',
      description: 'Get all global variables from the HC3 system',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'set_global_variable',
      description: 'Set the value of a global variable',
      inputSchema: {
        type: 'object',
        properties: {
          varName: {
            type: 'string',
            description: 'Variable name',
          },
          value: {
            type: ['string', 'number', 'boolean'],
            description: 'Variable value',
          },
        },
        required: ['varName', 'value'],
      },
    },
    {
      name: 'create_global_variable',
      description: 'Create a new global variable via POST /api/globalVariables. Refuses if the variable already exists (use set_global_variable to update). Pre-validates name format (HC3 requires [A-Za-z][A-Za-z0-9_]*). Supports isEnum globals with an enumValues list. Post-create verifies by refetching and asserting the stored value matches.',
      inputSchema: {
        type: 'object',
        properties: {
          varName: {
            type: 'string',
            description: 'Variable name. Must match [A-Za-z][A-Za-z0-9_]* (HC3 regex).'
          },
          value: {
            type: ['string', 'number', 'boolean'],
            description: 'Initial value. For isEnum globals must be one of enumValues.'
          },
          readOnly: {
            type: 'boolean',
            description: 'Mark as read-only system-style variable. Default false.'
          },
          isEnum: {
            type: 'boolean',
            description: 'Create as enum variable. Default false.'
          },
          enumValues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed enum values. Required when isEnum=true.'
          }
        },
        required: ['varName', 'value']
      }
    },
  ],

  handlers: {
    async get_global_variables(hc3): Promise<any> {
      return await hc3.request('/api/globalVariables');
    },

    async create_global_variable(hc3, args: {
      varName: string;
      value: any;
      readOnly?: boolean;
      isEnum?: boolean;
      enumValues?: string[];
    }): Promise<any> {
      if (typeof args?.varName !== 'string' || args.varName.length === 0) {
        throw new Error('create_global_variable requires a non-empty varName.');
      }
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(args.varName)) {
        throw new Error(
          `create_global_variable: varName ${JSON.stringify(args.varName)} does not match HC3's required format [A-Za-z][A-Za-z0-9_]* (must start with a letter; letters, digits, and underscores only).`
        );
      }
      if (args.isEnum) {
        if (!Array.isArray(args.enumValues) || args.enumValues.length === 0) {
          throw new Error('create_global_variable: isEnum=true requires a non-empty enumValues array.');
        }
        const candidate = String(args.value);
        if (!args.enumValues.includes(candidate)) {
          throw new Error(
            `create_global_variable: initial value ${JSON.stringify(args.value)} is not in enumValues ${JSON.stringify(args.enumValues)} (case-sensitive).`
          );
        }
      }

      const encoded = encodeURIComponent(args.varName);
      try {
        await hc3.request(`/api/globalVariables/${encoded}`);
        throw new Error(
          `create_global_variable refuses to overwrite: variable '${args.varName}' already exists. Use set_global_variable to update, or delete_global_variable first.`
        );
      } catch (e: any) {
        const msg = String(e?.message ?? '');
        if (!/404|not.?found/i.test(msg) && !msg.startsWith('create_global_variable refuses')) {
          throw e;
        }
        if (msg.startsWith('create_global_variable refuses')) throw e;
      }

      const body: Record<string, any> = { name: args.varName, value: args.value };
      if (args.readOnly !== undefined) body.readOnly = args.readOnly;
      if (args.isEnum) {
        body.isEnum = true;
        body.enumValues = args.enumValues;
      }

      const created: any = await hc3.request('/api/globalVariables', 'POST', body);

      const after: any = await hc3.request(`/api/globalVariables/${encoded}`);
      if (String(after?.value) !== String(args.value)) {
        throw new Error(
          `create_global_variable: post-create value mismatch for '${args.varName}'. Submitted ${JSON.stringify(args.value)}, stored ${JSON.stringify(after?.value)}.`
        );
      }
      return {
        created: args.varName,
        value: after?.value,
        isEnum: !!after?.isEnum,
        enumValues: after?.enumValues,
        readOnly: !!after?.readOnly,
        raw: created
      };
    },

    async set_global_variable(hc3, args: { varName: string; value: any }): Promise<any> {
      const encoded = encodeURIComponent(args.varName);
      const existing: any = await hc3.request(`/api/globalVariables/${encoded}`);

      if (existing?.readOnly) {
        throw new Error(
          `Global variable '${args.varName}' is read-only (HC3 system variable) and cannot be set via this tool.`
        );
      }

      let coerced: any;
      if (existing?.isEnum) {
        const enumValues: string[] = Array.isArray(existing.enumValues) ? existing.enumValues : [];
        const candidate = String(args.value);
        if (!enumValues.includes(candidate)) {
          throw new Error(
            `Global variable '${args.varName}' is an enum with values [${enumValues.map(v => `'${v}'`).join(', ')}]. ` +
            `Submitted value ${JSON.stringify(args.value)} is not in the set (match is case-sensitive).`
          );
        }
        coerced = candidate;
      } else {
        const storedType = typeof existing?.value;
        if (storedType === 'number') {
          const n = typeof args.value === 'number' ? args.value : Number(args.value);
          if (!Number.isFinite(n)) {
            throw new Error(
              `Global variable '${args.varName}' is numeric; submitted value ${JSON.stringify(args.value)} is not a number.`
            );
          }
          coerced = n;
        } else if (storedType === 'boolean') {
          if (typeof args.value === 'boolean') coerced = args.value;
          else if (args.value === 'true' || args.value === 1) coerced = true;
          else if (args.value === 'false' || args.value === 0) coerced = false;
          else {
            throw new Error(
              `Global variable '${args.varName}' is boolean; submitted value ${JSON.stringify(args.value)} cannot be coerced to boolean.`
            );
          }
        } else {
          coerced = typeof args.value === 'string' ? args.value : String(args.value);
        }
      }

      await hc3.request(`/api/globalVariables/${encoded}`, 'PUT', { value: coerced });

      const after: any = await hc3.request(`/api/globalVariables/${encoded}`);
      if (String(after?.value) !== String(coerced)) {
        throw new Error(
          `Post-write verification failed for global variable '${args.varName}': ` +
          `submitted ${JSON.stringify(coerced)}, HC3 stored ${JSON.stringify(after?.value)}.`
        );
      }

      return {
        name: args.varName,
        previous: { value: existing?.value, isEnum: !!existing?.isEnum },
        current: { value: after?.value, isEnum: !!after?.isEnum }
      };
    },

    async delete_global_variable(hc3, args: { varName: string; allow_system?: boolean }): Promise<any> {
      if (typeof args?.varName !== 'string' || args.varName.length === 0) {
        throw new Error('delete_global_variable requires a non-empty varName.');
      }
      const encoded = encodeURIComponent(args.varName);

      const existing: any = await hc3.request(`/api/globalVariables/${encoded}`);
      if (existing?.readOnly && !args.allow_system) {
        throw new Error(
          `delete_global_variable refuses '${args.varName}': variable is readOnly (HC3 system variable). Pass allow_system=true to override.`
        );
      }

      await hc3.request(`/api/globalVariables/${encoded}`, 'DELETE');

      try {
        await hc3.request(`/api/globalVariables/${encoded}`);
        throw new Error(
          `delete_global_variable: post-delete verify failed — '${args.varName}' still exists after DELETE.`
        );
      } catch (e: any) {
        if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
      }

      return {
        deleted: args.varName,
        lastValue: existing?.value,
        wasEnum: !!existing?.isEnum,
        wasReadOnly: !!existing?.readOnly
      };
    },
  },
};
