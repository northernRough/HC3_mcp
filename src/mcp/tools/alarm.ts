// Alarm partition tools.

import { ToolModule } from './registry';

export const alarm: ToolModule = {
  schemas: [
    {
      name: 'get_alarm_partitions',
      description: 'Get all alarm partitions',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_alarm_partition',
      description:
        'Get specific alarm partition by ID. The bare-id endpoint ' +
        '/api/alarms/v1/partitions/{id} returns 404 on current HC3 firmware ' +
        '(5.20x); the wrapper fetches the full partition list via ' +
        '/api/alarms/v1/partitions and filters in-process. See ' +
        'KNOWN_DEAD_ENDPOINTS.md for the catalogue of dead endpoints this ' +
        'server routes around.',
      inputSchema: {
        type: 'object',
        properties: {
          partitionId: {
            type: 'number',
            description: 'Alarm partition ID',
          },
        },
        required: ['partitionId'],
      },
    },
    {
      name: 'arm_alarm_partition',
      description: 'Arm alarm partition',
      inputSchema: {
        type: 'object',
        properties: {
          partitionId: {
            type: 'number',
            description: 'Alarm partition ID',
          },
          armingType: {
            type: 'string',
            description: 'Arming type (full, partial, night)',
            enum: ['full', 'partial', 'night'],
          },
        },
        required: ['partitionId', 'armingType'],
      },
    },
    {
      name: 'disarm_alarm_partition',
      description: 'Disarm alarm partition',
      inputSchema: {
        type: 'object',
        properties: {
          partitionId: {
            type: 'number',
            description: 'Alarm partition ID',
          },
        },
        required: ['partitionId'],
      },
    },
    {
      name: 'get_alarm_history',
      description: 'Get alarm system history',
      inputSchema: {
        type: 'object',
        properties: {
          partitionId: {
            type: 'number',
            description: 'Optional: Filter by partition ID',
          },
          limit: {
            type: 'number',
            description: 'Limit number of results (default: 100)',
          },
          offset: {
            type: 'number',
            description: 'Offset for pagination (default: 0)',
          },
        },
      },
    },
    {
      name: 'get_alarm_devices',
      description: 'Get alarm system devices',
      inputSchema: {
        type: 'object',
        properties: {
          partitionId: {
            type: 'number',
            description: 'Optional: Filter by partition ID',
          },
        },
      },
    },
  ],

  handlers: {
    async get_alarm_partitions(hc3): Promise<any> {
      return await hc3.request('/api/alarms/v1/partitions');
    },

    async get_alarm_partition(hc3, args: { partitionId: number }): Promise<any> {
      // /api/alarms/v1/partitions/{id} returns 404 on current firmware (5.20x).
      // Same dead-endpoint pattern as /api/energy/{id} and /api/quickApp/{id}
      // (fixed in 3.4.1 and 3.5.1). Fetch the full partition list and filter.
      const partitions = await hc3.request('/api/alarms/v1/partitions') as any[];
      const found = (partitions || []).find((p: any) => p?.id === args.partitionId);
      if (!found) {
        throw new Error(
          `Alarm partition ${args.partitionId} not found in /api/alarms/v1/partitions. ` +
          `The bare-id endpoint /api/alarms/v1/partitions/{id} is also dead on current ` +
          `HC3 firmware; this wrapper routes around it via the list. ` +
          `Use get_alarm_partitions to enumerate available partitions.`,
        );
      }
      return found;
    },

    async arm_alarm_partition(hc3, args: { partitionId: number; armingType: string }): Promise<any> {
      await hc3.request(`/api/alarms/v1/partitions/${args.partitionId}/actions/arm`, 'POST', {
        armingType: args.armingType
      });
      return `Alarm partition ${args.partitionId} armed with ${args.armingType} mode.`;
    },

    async disarm_alarm_partition(hc3, args: { partitionId: number }): Promise<any> {
      await hc3.request(`/api/alarms/v1/partitions/${args.partitionId}/actions/disarm`, 'POST');
      return `Alarm partition ${args.partitionId} disarmed successfully.`;
    },

    async get_alarm_history(hc3, args: { partitionId?: number; limit?: number; offset?: number }): Promise<any> {
      let url = '/api/alarms/v1/history';
      const params = new URLSearchParams();

      if (args.partitionId) {
        params.append('partitionId', args.partitionId.toString());
      }
      if (args.limit) {
        params.append('limit', args.limit.toString());
      }
      if (args.offset) {
        params.append('offset', args.offset.toString());
      }

      if (params.toString()) {
        url += '?' + params.toString();
      }

      return await hc3.request(url);
    },

    async get_alarm_devices(hc3, args: { partitionId?: number }): Promise<any> {
      let url = '/api/alarms/v1/devices';
      if (args.partitionId) {
        url += `?partitionId=${args.partitionId}`;
      }
      return await hc3.request(url);
    },
  },
};
