// Backup management tools.

import { ToolModule } from './registry';

export const backups: ToolModule = {
  schemas: [
    {
      name: 'can_create_backup',
      description: 'Check if backups can be created',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_local_backup_status',
      description: 'Get local backup status',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_remote_backup_status',
      description: 'Get remote backup status',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_backups',
      description: 'Get list of available backups',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Backup type (local, remote, all)',
            enum: ['local', 'remote', 'all'],
          },
        },
      },
    },
    {
      name: 'create_backup',
      description: 'Create a new backup',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Backup name',
          },
          type: {
            type: 'string',
            description: 'Backup type (local, remote)',
            enum: ['local', 'remote'],
          },
        },
        required: ['name', 'type'],
      },
    },
  ],

  handlers: {
    async can_create_backup(hc3): Promise<any> {
      return await hc3.request('/api/service/canCreateBackups');
    },

    async get_local_backup_status(hc3): Promise<any> {
      return await hc3.request('/api/service/getLocalBackupsStatus');
    },

    async get_remote_backup_status(hc3): Promise<any> {
      return await hc3.request('/api/service/getRemoteBackupsStatus');
    },

    async get_backups(hc3, args: { type?: string }): Promise<any> {
      let url = '/api/service/backups';
      if (args.type && args.type !== 'all') {
        url += `?type=${args.type}`;
      }
      return await hc3.request(url);
    },

    async create_backup(hc3, args: { name: string; type: string }): Promise<any> {
      await hc3.request('/api/service/backups', 'POST', {
        name: args.name,
        type: args.type
      });
      return `Backup '${args.name}' of type '${args.type}' creation initiated successfully.`;
    },
  },
};
