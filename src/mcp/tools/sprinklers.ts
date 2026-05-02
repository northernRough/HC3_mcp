// Sprinkler / irrigation system tools.

import { ToolModule } from './registry';

export const sprinklers: ToolModule = {
  schemas: [
    {
      name: 'get_sprinkler_systems',
      description: 'Get all sprinkler systems',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_sprinkler_system',
      description: 'Get specific sprinkler system by ID',
      inputSchema: {
        type: 'object',
        properties: {
          systemId: {
            type: 'number',
            description: 'Sprinkler system ID',
          },
        },
        required: ['systemId'],
      },
    },
    {
      name: 'control_sprinkler_system',
      description: 'Control sprinkler system (start, stop, pause)',
      inputSchema: {
        type: 'object',
        properties: {
          systemId: {
            type: 'number',
            description: 'Sprinkler system ID',
          },
          action: {
            type: 'string',
            description: 'Action to perform',
            enum: ['start', 'stop', 'pause', 'resume'],
          },
          zoneId: {
            type: 'number',
            description: 'Optional: Specific zone ID for zone-specific actions',
          },
          duration: {
            type: 'number',
            description: 'Optional: Duration in minutes for start action',
          },
        },
        required: ['systemId', 'action'],
      },
    },
  ],

  handlers: {
    async get_sprinkler_systems(hc3): Promise<any> {
      return await hc3.request('/api/panels/sprinklers');
    },

    async get_sprinkler_system(hc3, args: { systemId: number }): Promise<any> {
      return await hc3.request(`/api/panels/sprinklers/${args.systemId}`);
    },

    async control_sprinkler_system(hc3, args: { systemId: number; action: string; zoneId?: number; duration?: number }): Promise<any> {
      const endpoint = `/api/panels/sprinklers/${args.systemId}/actions/${args.action}`;
      const requestData: any = {};

      if (args.zoneId) {
        requestData.zoneId = args.zoneId;
      }
      if (args.duration) {
        requestData.duration = args.duration;
      }

      await hc3.request(endpoint, 'POST', Object.keys(requestData).length > 0 ? requestData : undefined);
      return `Sprinkler system ${args.systemId} action '${args.action}' executed successfully.`;
    },
  },
};
