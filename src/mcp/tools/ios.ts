// iOS device registration tools.

import { ToolModule } from './registry';

export const ios: ToolModule = {
  schemas: [
    {
      name: 'get_ios_devices',
      description: 'Get registered iOS devices',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'register_ios_device',
      description: 'Register a new iOS device',
      inputSchema: {
        type: 'object',
        properties: {
          deviceToken: {
            type: 'string',
            description: 'iOS device token',
          },
          name: {
            type: 'string',
            description: 'Device name',
          },
        },
        required: ['deviceToken', 'name'],
      },
    },
  ],

  handlers: {
    async get_ios_devices(hc3): Promise<any> {
      return await hc3.request('/api/iosDevices');
    },

    async register_ios_device(hc3, args: { deviceToken: string; name: string }): Promise<any> {
      await hc3.request('/api/iosDevices', 'POST', {
        deviceToken: args.deviceToken,
        name: args.name
      });
      return `iOS device '${args.name}' registered successfully.`;
    },
  },
};
