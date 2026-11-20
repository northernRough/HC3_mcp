// Room-management tools.

import { ToolModule } from './registry';
import { deepMerge, verifyWrite } from '../util';
import { isNotFound } from '../hc3-client';

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
        name: 'get_sections',
        description: 'List room sections: the grouping above rooms (e.g. a "Bedrooms" section holding the bedroom and ensuite rooms). Reads GET /api/sections and GET /api/rooms and returns each section, in sortOrder, with its rooms ({id, name}). Rooms whose sectionID matches no section are listed under `unsectioned`. Pass sectionId for one section. Use the ids with create_room/modify_room `sectionID` to move a room between sections. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'number', description: 'Optional: return only this section.' },
          },
        },
      },
      {
        name: 'create_room',
        description: 'Create a new room via POST /api/rooms. Returns the room with its HC3-assigned id. Post-create verify by refetch.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Room display name' },
            sectionID: { type: 'number', description: 'Parent section id (list them with get_sections).' },
            icon: { type: 'string', description: 'Icon name (e.g. "room_living"). Defaults to HC3 default if omitted.' },
            category: { type: 'string', description: 'Room category (e.g. "livingroom", "bedroom", "other").' },
            visible: { type: 'boolean', description: 'Visible in UI. Defaults true.' }
          },
          required: ['name']
        }
      },
      {
        name: 'modify_room',
        description: 'Update room fields (name, sectionID — ids from get_sections, icon, category, visible, defaultSensors, defaultThermostat, sortOrder) via PUT /api/rooms/{id}. Read-modify-write + post-write verify.',
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

    async get_sections(hc3, args: { sectionId?: number } = {}): Promise<any> {
      if (args?.sectionId !== undefined && typeof args.sectionId !== 'number') {
        throw new Error('get_sections: sectionId must be a number.');
      }
      const [sections, rooms] = await Promise.all([
        hc3.request('/api/sections'),
        hc3.request('/api/rooms'),
      ]);
      if (!Array.isArray(sections) || !Array.isArray(rooms)) {
        throw new Error('get_sections: HC3 did not return arrays for /api/sections and /api/rooms.');
      }
      const ids = new Set(sections.map((x: any) => x.id));
      const roomsOf = (id: number) => rooms
        .filter((r: any) => r.sectionID === id)
        .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((r: any) => ({ id: r.id, name: r.name }));
      const out = [...sections]
        .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((x: any) => ({ id: x.id, name: x.name, sortOrder: x.sortOrder, rooms: roomsOf(x.id) }));
      if (args?.sectionId !== undefined) {
        const one = out.find(x => x.id === args.sectionId);
        if (!one) {
          throw new Error(`get_sections: no section ${args.sectionId}. Sections: ${out.map(x => `${x.id} ${x.name}`).join(', ')}.`);
        }
        return one;
      }
      const unsectioned = rooms
        .filter((r: any) => !ids.has(r.sectionID))
        .map((r: any) => ({ id: r.id, name: r.name, sectionID: r.sectionID }));
      return { sections: out, unsectioned };
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
      let stillExists = false;
      try {
        await hc3.request(`/api/rooms/${args.roomId}`);
        stillExists = true;
      } catch (e: any) {
        if (!isNotFound(e)) throw e;
      }
      if (stillExists) {
        throw new Error(
          `delete_room: post-delete verify failed — room ${args.roomId} still exists.`
        );
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
