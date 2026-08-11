// Backup management tools.

import { ToolModule } from './registry';

export const backups: ToolModule = {
  schemas: [
    {
      name: 'can_create_backup',
      description: 'Check whether a backup can currently be created. Worth calling before create_backup — note that create_backup REBOOTS the gateway, so confirm the operator wants that first.',
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
      description: 'Remote (Fibaro cloud) backup status: canCreateAutoBackup / canCreateManualBackup / canRestoreBackup. Both create flags go false when the cloud account is over its storage quota, and from then on **no remote backup is taken and nothing warns you** — a gateway can sit for months with its newest backup long stale. If the flags are false, free space by deleting old backups rather than assuming the feature is broken.',
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
      description: 'Create a system backup. **This REBOOTS the gateway.** HC3 restarts to take a backup, so every automation stops for the duration and anything mid-flight is interrupted — do not call this speculatively, as a precaution before another change, or without the operator expecting it. Because of the reboot, backups on a live system are normally taken deliberately at quiet times or alongside a firmware upgrade, not on a schedule.\n\nRemote (Fibaro cloud) backups also fail silently once the account is over quota: get_remote_backup_status reports canCreateAutoBackup/canCreateManualBackup false, and no new backup appears. Check that before assuming a backup regime is healthy — a gateway can go months with no usable backup and no warning.\n\nBackup payloads are OpenSSL-encrypted, so a .fbi cannot be opened to extract individual items; restoring is all-or-nothing and rolls the whole gateway back.',
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
