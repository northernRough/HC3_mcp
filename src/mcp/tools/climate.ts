// Climate-zone tools.

import { ToolModule } from './registry';
import { deepMerge, verifyWrite } from '../util';

export const climate: ToolModule = {
  schemas: [
    {
      name: 'get_climate_zones',
      description: 'Get all climate zones',
      inputSchema: {
        type: 'object',
        properties: {
          detailed: {
            type: 'boolean',
            description: 'Return detailed climate zone information (default: false)',
          },
        },
      },
    },
    {
      name: 'get_climate_zone',
      description: 'Get specific climate zone by ID',
      inputSchema: {
        type: 'object',
        properties: {
          zoneId: {
            type: 'number',
            description: 'Climate zone ID',
          },
        },
        required: ['zoneId'],
      },
    },
    {
      name: 'update_climate_zone',
      description: 'Update climate zone fields in a single atomic PUT. Use `topLevel` for zone-body fields (e.g., `name`, `active`, `mode`) and `properties` for nested zone properties (e.g., `handSetPointHeating`, `vacationMode`, schedule objects like `monday.morning`). At least one must be provided. `properties` is written via read-modify-write: the tool fetches the current zone, deep-merges submitted scalars and nested-object keys into the existing properties, then PUTs the merged result. This preserves unsubmitted sibling keys inside schedule sub-objects. Array-valued properties (`devices`, `incompatibleDevices`, `temperatureSensors`) are fully replaced by whatever is submitted, so submit the complete array if editing them. Writes are verified by refetching and comparing each submitted field; throws on any mismatch rather than silently succeeding.',
      inputSchema: {
        type: 'object',
        properties: {
          zoneId: {
            type: 'number',
            description: 'Climate zone ID',
          },
          topLevel: {
            type: 'object',
            description: 'Top-level zone fields to modify (e.g., {name: "New Name", active: true, mode: "Schedule"}). Sent at the root of the PUT body.',
          },
          properties: {
            type: 'object',
            description: 'Nested zone properties to modify. Scalars (handSetPointHeating, vacationMode, etc.) and schedule sub-objects (monday.morning, etc.) are deep-merged into the current zone via read-modify-write, so sibling keys are preserved. Array-valued properties (devices, incompatibleDevices, temperatureSensors) are fully replaced — submit the full current array if editing them.',
          },
        },
        required: ['zoneId'],
      },
    },
  ],

  handlers: {
    async get_climate_zones(hc3, args: { detailed?: boolean }): Promise<any> {
      const detailed = args.detailed ? '?detailed=true' : '';
      return await hc3.request(`/api/panels/climate${detailed}`);
    },

    async get_climate_zone(hc3, args: { zoneId: number }): Promise<any> {
      return await hc3.request(`/api/panels/climate/${args.zoneId}`);
    },

    async update_climate_zone(hc3, args: {
      zoneId: number;
      topLevel?: Record<string, any>;
      properties?: Record<string, any>;
    }): Promise<any> {
      const { zoneId, topLevel, properties } = args;

      const topLevelKeys = topLevel ? Object.keys(topLevel) : [];
      const propertiesKeys = properties ? Object.keys(properties) : [];
      if (topLevelKeys.length === 0 && propertiesKeys.length === 0) {
        throw new Error(
          'update_climate_zone requires at least one of topLevel or properties with at least one field.'
        );
      }

      const body: Record<string, any> = {};
      if (topLevelKeys.length > 0) {
        Object.assign(body, topLevel);
      }
      if (propertiesKeys.length > 0) {
        // Read-modify-write so partial submissions in nested schedule objects
        // (e.g. {monday: {morning: {...}}}) don't wipe sibling keys.
        const current = await hc3.request(`/api/panels/climate/${zoneId}`);
        const currentProps = current?.properties ?? {};
        body.properties = deepMerge(currentProps, properties);
      }

      await hc3.request(`/api/panels/climate/${zoneId}`, 'PUT', body);
      const after = await hc3.request(`/api/panels/climate/${zoneId}`);
      verifyWrite(topLevel, properties, after, `climate zone ${zoneId}`);

      const submittedSummary: Record<string, any> = {};
      if (topLevelKeys.length > 0) submittedSummary.topLevel = topLevel;
      if (propertiesKeys.length > 0) submittedSummary.properties = properties;
      return {
        zoneId,
        submitted: submittedSummary,
        verified: true
      };
    },
  },
};
