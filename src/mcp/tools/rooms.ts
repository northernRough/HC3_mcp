// Room-management tools.

import { ToolModule } from './registry';
import { deepMerge, verifyWrite } from '../util';

export const rooms: ToolModule = {
  schemas: [
      {
        name: 'get_rooms',
        description: 'Get all rooms in the Fibaro HC3 system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_room',
        description: 'Get a single room by id. Wraps GET /api/rooms/{id}.',
        inputSchema: {
          type: 'object',
          properties: { roomId: { type: 'number', description: 'Room id' } },
          required: ['roomId']
        }
      },
      {
        name: 'create_room',
        description: 'Create a new room via POST /api/rooms. Returns the room with its HC3-assigned id. Post-create verify by refetch.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Room display name' },
            sectionID: { type: 'number', description: 'Parent section id' },
            icon: { type: 'string', description: 'Icon name (e.g. "room_living"). Defaults to HC3 default if omitted.' },
            category: { type: 'string', description: 'Room category (e.g. "livingroom", "bedroom", "other").' },
            visible: { type: 'boolean', description: 'Visible in UI. Defaults true.' }
          },
          required: ['name']
        }
      },
      {
        name: 'modify_room',
        description: 'Update room fields (name, sectionID, icon, category, visible, defaultSensors, defaultThermostat, sortOrder) via PUT /api/rooms/{id}. Read-modify-write + post-write verify.',
        inputSchema: {
          type: 'object',
          properties: {
            roomId: { type: 'number', description: 'Room id to modify' },
            fields: { type: 'object', description: 'Partial update of the room record.' }
          },
          required: ['roomId', 'fields']
        }
      },
      {
        name: 'delete_room',
        description: 'Delete a room via DELETE /api/rooms/{id}. Safety: reads devices first and refuses if the room has devices unless reassign_to is supplied (a target roomId to batch-move the devices to before deletion). Cannot delete the default room (id of a room with isDefault=true).',
        inputSchema: {
          type: 'object',
          properties: {
            roomId: { type: 'number', description: 'Room id to delete' },
            reassign_to: { type: 'number', description: 'If the room has devices, batch-move them to this room before deletion. Without this, the tool refuses if the room has devices.' }
          },
          required: ['roomId']
        }
      },
      {
        name: 'assign_devices_to_room',
        description: 'Batch-move devices to a room via POST /api/rooms/{roomId}/groupAssignment. Useful after Z-Wave re-inclusion to quickly re-place the new ids. Body: {deviceIds: [...]}.',
        inputSchema: {
          type: 'object',
          properties: {
            roomId: { type: 'number', description: 'Target room id' },
            deviceIds: { type: 'array', items: { type: 'number' }, description: 'Device ids to move' }
          },
          required: ['roomId', 'deviceIds']
        }
      },
  ],

  handlers: {
    async get_rooms(hc3): Promise<any> {
      return await hc3.request('/api/rooms');
    },

    async get_room(hc3, args: { roomId: number }): Promise<any> {
      if (typeof args?.roomId !== 'number') throw new Error('get_room requires numeric roomId.');
      return await hc3.request(`/api/rooms/${args.roomId}`);
    },

    async create_room(hc3, args: {
      name: string;
      sectionID?: number;
      icon?: string;
      category?: string;
      visible?: boolean;
    }): Promise<any> {
      if (!args?.name) throw new Error('create_room requires name.');
      if (args.name.length > 20) {
        throw new Error(
          `create_room: name ${JSON.stringify(args.name)} is ${args.name.length} chars. ` +
          `HC3 silently truncates room names at 20 chars; use a shorter name.`
        );
      }
      const body: Record<string, any> = { name: args.name };
      if (args.sectionID !== undefined) body.sectionID = args.sectionID;
      if (args.icon !== undefined) body.icon = args.icon;
      if (args.category !== undefined) body.category = args.category;
      if (args.visible !== undefined) body.visible = args.visible;
      const created: any = await hc3.request('/api/rooms', 'POST', body);
      const newId = created?.id;
      if (typeof newId !== 'number') {
        throw new Error(`create_room: HC3 returned no id. Raw: ${JSON.stringify(created).slice(0, 300)}`);
      }
      const after: any = await hc3.request(`/api/rooms/${newId}`);
      if (after?.name !== args.name) {
        throw new Error(`create_room: post-create name mismatch. Submitted ${JSON.stringify(args.name)}, stored ${JSON.stringify(after?.name)}.`);
      }
      return { roomId: newId, room: after };
    },

    async modify_room(hc3, args: {
      roomId: number;
      fields: Record<string, any>;
    }): Promise<any> {
      if (typeof args?.roomId !== 'number') throw new Error('modify_room requires numeric roomId.');
      if (!args?.fields || typeof args.fields !== 'object' || Array.isArray(args.fields) || Object.keys(args.fields).length === 0) {
        throw new Error('modify_room requires a non-empty fields object.');
      }
      const current: any = await hc3.request(`/api/rooms/${args.roomId}`);
      const merged = deepMerge(current, args.fields);
      await hc3.request(`/api/rooms/${args.roomId}`, 'PUT', merged);
      const after: any = await hc3.request(`/api/rooms/${args.roomId}`);
      verifyWrite(args.fields, undefined, after, `room ${args.roomId}`);
      return { roomId: args.roomId, changedFields: Object.keys(args.fields), room: after };
    },

    async delete_room(hc3, args: { roomId: number; reassign_to?: number }): Promise<any> {
      if (typeof args?.roomId !== 'number') throw new Error('delete_room requires numeric roomId.');
      const room: any = await hc3.request(`/api/rooms/${args.roomId}`);
      if (room?.isDefault) {
        throw new Error(`delete_room refuses room ${args.roomId} (${room.name}): it is the default room and cannot be deleted.`);
      }
      const devices: any[] = await hc3.request(`/api/devices?roomID=${args.roomId}`);
      if (devices.length > 0) {
        if (typeof args.reassign_to !== 'number') {
          throw new Error(
            `delete_room refuses room ${args.roomId} (${room.name}): has ${devices.length} devices. ` +
            `Pass reassign_to=<targetRoomId> to batch-move them first, or move them manually.`
          );
        }
        await hc3.request(`/api/rooms/${args.reassign_to}/groupAssignment`, 'POST', {
          deviceIds: devices.map(d => d.id)
        });
      }
      await hc3.request(`/api/rooms/${args.roomId}`, 'DELETE');
      try {
        await hc3.request(`/api/rooms/${args.roomId}`);
        throw new Error(`delete_room: post-delete verify failed — room ${args.roomId} still exists.`);
      } catch (e: any) {
        if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
      }
      return {
        deleted: args.roomId,
        name: room.name,
        devicesReassigned: devices.length,
        reassignedTo: devices.length > 0 ? args.reassign_to : null
      };
    },

    async assign_devices_to_room(hc3, args: {
      roomId: number;
      deviceIds: number[];
    }): Promise<any> {
      if (typeof args?.roomId !== 'number') throw new Error('assign_devices_to_room requires numeric roomId.');
      if (!Array.isArray(args?.deviceIds) || args.deviceIds.length === 0) {
        throw new Error('assign_devices_to_room requires a non-empty deviceIds array.');
      }
      await hc3.request(`/api/rooms/${args.roomId}/groupAssignment`, 'POST', {
        deviceIds: args.deviceIds
      });
      const mismatches: Array<{ deviceId: number; reportedRoom: number }> = [];
      await Promise.all(args.deviceIds.map(async id => {
        try {
          const d: any = await hc3.request(`/api/devices/${id}`);
          if (d?.roomID !== args.roomId) mismatches.push({ deviceId: id, reportedRoom: d?.roomID });
        } catch {
          mismatches.push({ deviceId: id, reportedRoom: -1 });
        }
      }));
      if (mismatches.length > 0) {
        throw new Error(
          `assign_devices_to_room: post-assign verify failed for ${mismatches.length}/${args.deviceIds.length} devices. ` +
          `Mismatches: ${JSON.stringify(mismatches.slice(0, 10))}`
        );
      }
      return { roomId: args.roomId, assigned: args.deviceIds.length };
    },
  },
};
