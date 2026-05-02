// Notification-centre tools.

import { ToolModule } from './registry';
import { deepMerge, verifyWrite } from '../util';

export const notifications: ToolModule = {
  schemas: [
    {
      name: 'get_notifications',
      description: 'Get system notifications',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Limit number of results (default: 50)',
          },
          offset: {
            type: 'number',
            description: 'Offset for pagination (default: 0)',
          },
        },
      },
    },
    {
      name: 'mark_notification_read',
      description: 'Mark notification as read',
      inputSchema: {
        type: 'object',
        properties: {
          notificationId: {
            type: 'number',
            description: 'Notification ID',
          },
        },
        required: ['notificationId'],
      },
    },
    {
      name: 'clear_all_notifications',
      description: 'Clear all notifications',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_notification',
      description: 'Read a single notification by id. Wraps GET /api/notificationCenter/{id}. 404 if unknown.',
      inputSchema: {
        type: 'object',
        properties: { notificationId: { type: 'number', description: 'Notification id' } },
        required: ['notificationId']
      }
    },
    {
      name: 'update_notification',
      description: 'Update a notification via PUT /api/notificationCenter/{id}. Read-modify-write + post-write verify on submitted fields. Typically used to mark as read or to amend the data payload.',
      inputSchema: {
        type: 'object',
        properties: {
          notificationId: { type: 'number', description: 'Notification id' },
          fields: { type: 'object', description: 'Partial update (wasRead, priority, data, canBeDeleted, etc.)' }
        },
        required: ['notificationId', 'fields']
      }
    },
    {
      name: 'delete_notification',
      description: 'Delete a notification via DELETE /api/notificationCenter/{id}. Reads first to capture the data payload as a recovery trail. Refuses if canBeDeleted=false (HC3-system-protected) unless allow_system=true. Post-delete verifies by refetch expecting 404.',
      inputSchema: {
        type: 'object',
        properties: {
          notificationId: { type: 'number', description: 'Notification id' },
          allow_system: { type: 'boolean', description: 'Required to delete notifications where canBeDeleted=false. Default false.' }
        },
        required: ['notificationId']
      }
    },
  ],

  handlers: {
    async get_notifications(hc3, args: { limit?: number; offset?: number }): Promise<any> {
      let url = '/api/panels/notifications';
      const params = new URLSearchParams();

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

    async mark_notification_read(hc3, args: { notificationId: number }): Promise<any> {
      await hc3.request(`/api/panels/notifications/${args.notificationId}/read`, 'POST');
      return `Notification ${args.notificationId} marked as read.`;
    },

    async clear_all_notifications(hc3): Promise<any> {
      await hc3.request('/api/panels/notifications/clear', 'POST');
      return 'All notifications cleared successfully.';
    },

    async get_notification(hc3, args: { notificationId: number }): Promise<any> {
      if (typeof args?.notificationId !== 'number') throw new Error('get_notification requires numeric notificationId.');
      return await hc3.request(`/api/notificationCenter/${args.notificationId}`);
    },

    async update_notification(hc3, args: {
      notificationId: number;
      fields: Record<string, any>;
    }): Promise<any> {
      if (typeof args?.notificationId !== 'number') throw new Error('update_notification requires numeric notificationId.');
      if (!args?.fields || typeof args.fields !== 'object' || Array.isArray(args.fields) || Object.keys(args.fields).length === 0) {
        throw new Error('update_notification requires a non-empty fields object.');
      }
      const current: any = await hc3.request(`/api/notificationCenter/${args.notificationId}`);
      const merged = deepMerge(current, args.fields);
      await hc3.request(`/api/notificationCenter/${args.notificationId}`, 'PUT', merged);
      const after: any = await hc3.request(`/api/notificationCenter/${args.notificationId}`);
      verifyWrite(args.fields, undefined, after, `notification ${args.notificationId}`);
      return { notificationId: args.notificationId, changedFields: Object.keys(args.fields), notification: after };
    },

    async delete_notification(hc3, args: { notificationId: number; allow_system?: boolean }): Promise<any> {
      if (typeof args?.notificationId !== 'number') throw new Error('delete_notification requires numeric notificationId.');
      const existing: any = await hc3.request(`/api/notificationCenter/${args.notificationId}`);
      if (existing?.canBeDeleted === false && !args.allow_system) {
        throw new Error(
          `delete_notification refuses notification ${args.notificationId}: canBeDeleted=false (HC3-system-protected). Pass allow_system=true to override.`
        );
      }
      await hc3.request(`/api/notificationCenter/${args.notificationId}`, 'DELETE');
      try {
        await hc3.request(`/api/notificationCenter/${args.notificationId}`);
        throw new Error(`delete_notification: post-delete verify failed — notification ${args.notificationId} still exists.`);
      } catch (e: any) {
        if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
      }
      return {
        deleted: args.notificationId,
        lastType: existing?.type,
        lastData: existing?.data
      };
    },
  },
};
