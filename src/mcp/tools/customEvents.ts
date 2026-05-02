// Custom-event tools (HC3's named event bus, fired by scenes/QAs).

import { ToolModule } from './registry';

export const customEvents: ToolModule = {
  schemas: [
    {
      name: 'get_custom_events',
      description: 'Get all custom events',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'create_custom_event',
      description: 'Create a new custom event',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Event name',
          },
          userDescription: {
            type: 'string',
            description: 'Event description',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'trigger_custom_event',
      description: 'Trigger a custom event',
      inputSchema: {
        type: 'object',
        properties: {
          eventId: {
            type: 'number',
            description: 'Custom event ID',
          },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'get_custom_event',
      description: 'Read a single custom event by name. Wraps GET /api/customEvents/{name}. Returns {name, userDescription}. HTTP 404 if unknown.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Custom event name' }
        },
        required: ['name']
      }
    },
    {
      name: 'update_custom_event',
      description: 'Update a custom event\'s userDescription and/or rename it. Wraps PUT /api/customEvents/{name}. Read-modify-write: reads current, merges submitted fields, PUTs. If newName is supplied, verifies by refetching via the new name. Otherwise verifies under the original name. Throws on mismatch.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Current custom event name' },
          userDescription: { type: 'string', description: 'New description. Omit to leave unchanged.' },
          newName: { type: 'string', description: 'New name. Omit to leave unchanged.' }
        },
        required: ['name']
      }
    },
    {
      name: 'delete_custom_event',
      description: 'Delete a custom event by name. Wraps DELETE /api/customEvents/{name}. Reads the event first to capture userDescription as a recovery trail. Post-delete verifies by refetch expecting 404.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Custom event name to delete' }
        },
        required: ['name']
      }
    },
  ],

  handlers: {
    async get_custom_events(hc3): Promise<any> {
      return await hc3.request('/api/customEvents');
    },

    async create_custom_event(hc3, args: { name: string; userDescription?: string }): Promise<any> {
      const result = await hc3.request('/api/customEvents', 'POST', args);
      return `Custom event '${args.name}' created successfully with ID ${result.id}.`;
    },

    async trigger_custom_event(hc3, args: { eventId: number }): Promise<any> {
      await hc3.request(`/api/customEvents/${args.eventId}`, 'POST');
      return `Custom event ${args.eventId} triggered successfully.`;
    },

    async get_custom_event(hc3, args: { name: string }): Promise<any> {
      if (!args?.name) throw new Error('get_custom_event requires name.');
      return await hc3.request(`/api/customEvents/${encodeURIComponent(args.name)}`);
    },

    async update_custom_event(hc3, args: {
      name: string;
      userDescription?: string;
      newName?: string;
    }): Promise<any> {
      if (!args?.name) throw new Error('update_custom_event requires name.');
      if (args.userDescription === undefined && args.newName === undefined) {
        throw new Error('update_custom_event requires at least one of userDescription or newName.');
      }
      const current: any = await hc3.request(`/api/customEvents/${encodeURIComponent(args.name)}`);
      const body: Record<string, any> = { ...current };
      if (args.userDescription !== undefined) body.userDescription = args.userDescription;
      if (args.newName !== undefined) body.name = args.newName;
      await hc3.request(`/api/customEvents/${encodeURIComponent(args.name)}`, 'PUT', body);
      const verifyName = args.newName ?? args.name;
      const after: any = await hc3.request(`/api/customEvents/${encodeURIComponent(verifyName)}`);
      if (args.userDescription !== undefined && after.userDescription !== args.userDescription) {
        throw new Error(
          `update_custom_event: post-write userDescription mismatch. Submitted ${JSON.stringify(args.userDescription)}, stored ${JSON.stringify(after.userDescription)}.`
        );
      }
      if (args.newName !== undefined && after.name !== args.newName) {
        throw new Error(
          `update_custom_event: post-write name mismatch. Submitted ${JSON.stringify(args.newName)}, stored ${JSON.stringify(after.name)}.`
        );
      }
      return { event: after, renamed: args.newName !== undefined && args.newName !== args.name };
    },

    async delete_custom_event(hc3, args: { name: string }): Promise<any> {
      if (!args?.name) throw new Error('delete_custom_event requires name.');
      const encoded = encodeURIComponent(args.name);
      const existing: any = await hc3.request(`/api/customEvents/${encoded}`);
      await hc3.request(`/api/customEvents/${encoded}`, 'DELETE');
      try {
        await hc3.request(`/api/customEvents/${encoded}`);
        throw new Error(`delete_custom_event: post-delete verify failed — '${args.name}' still exists.`);
      } catch (e: any) {
        if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
      }
      return {
        deleted: args.name,
        lastUserDescription: existing?.userDescription ?? null
      };
    },
  },
};
