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
      description: 'Get specific alarm partition by ID',
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
      return await hc3.request(`/api/alarms/v1/partitions/${args.partitionId}`);
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
