// Device tools — the largest single domain. Includes the resilient
// name/endpoint resolution helpers, control_device with declared-action
// validation and setVariable rejection, modify_device with the full set
// of HC3 silent-write traps, and delete_device with Z-Wave / cascade /
// system-id guards.
//
// `devices.schemas` is the contiguous 9-tool cluster spread by
// handleListTools. The 10th tool's schema (`delete_device`) lives at
// the legacy tools/list tail with delete_global_variable and
// delete_plugin and is exported separately as `deleteDeviceSchema`
// so the server can reference it at that slot. The handler for
// delete_device is part of `devices.handlers` and dispatches via
// the registry.

import { ToolModule } from './registry';
import { MCPTool } from '../types';
import { verifyWrite } from '../util';

export const deleteDeviceSchema: MCPTool =
      {
        name: "delete_device",
        description: "Delete a single device by id via DELETE /api/devices/{id}. Intended for QuickApps and explicitly-installed plugins. Guards: (1) refuses ids < 10 (reserved HC3 system devices); (2) reads the device first to inspect interfaces + children; (3) refuses Z-Wave devices (interfaces includes 'zwave' with no quickApp) unless allow_physical=true — the REST delete does not perform a proper Z-Wave exclusion, leaving the mesh with a ghost node entry; exclude via the HC3 Web UI for Z-Wave hardware; (4) refuses devices with children unless cascade=true, listing them in the rejection so the caller knows the blast radius. Post-delete verifies by refetch (expects HTTP 404).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "HC3 device id to delete. Must be >= 10."
            },
            cascade: {
              type: "boolean",
              description: "Allow deletion even when the device has children (children are deleted with it). Defaults false."
            },
            allow_physical: {
              type: "boolean",
              description: "Allow deletion of Z-Wave physical devices via REST. Defaults false — REST delete skips mesh exclusion."
            }
          },
          required: ["deviceId"]
        }
      };

export const devices: ToolModule = {
  schemas: [
      {
        name: 'get_devices',
        description: 'Get all devices from Fibaro HC3, with optional filtering by room or device type',
        inputSchema: {
          type: 'object',
          properties: {
            roomId: {
              type: 'number',
              description: 'Optional: Filter devices by room ID',
            },
            deviceType: {
              type: 'string',
              description: 'Optional: Filter devices by type (e.g., "light", "sensor", "dimmer")',
            },
            interface: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: Filter devices by interface (e.g., ["zwave", "energy"])',
            },
          },
        },
      },
      {
        name: 'filter_devices',
        description: 'Server-side multi-criteria device filter via POST /api/devices/filter. Richer than get_devices\' query-string filters: accepts multiple ANDed filter predicates and projects only requested attributes — much smaller payload than get_devices when you already know which fields you need. Body: {filters: [{filter, value}], attributes: {main: [...]}}. Common filter keys: deviceID (array of ids), enabled, visible, roomID, parentId, deviceState, type, baseType, interface, isPlugin, hasProperty, hasNoProperty. Values are arrays (coerce to string if HC3 expects strings). attributes.main picks which fields to return per device.',
        inputSchema: {
          type: 'object',
          properties: {
            filters: {
              type: 'array',
              description: 'Array of {filter: string, value: any[]} predicates. All predicates ANDed.',
              items: {
                type: 'object',
                properties: {
                  filter: { type: 'string', description: 'Filter key, e.g. "deviceID", "enabled", "roomID", "type"' },
                  value: { type: 'array', description: 'Values to match. Arrays of strings, numbers, or booleans.' }
                },
                required: ['filter', 'value']
              }
            },
            attributes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Attribute names to return per device. E.g. ["id", "name", "roomID", "type"]. Omit to get all.'
            }
          },
          required: ['filters']
        }
      },
      {
        name: 'find_devices_by_name',
        description: 'Resolve a human-readable device name to one or more HC3 devices. Case-insensitive substring match by default (exact-match opt-in). Filters to parent/top-level devices only (parentId in {0, 1}) — i.e. system/root devices (QAs, HC3 controllers, grouping wrappers) and direct Z-Wave nodes (the physical device as a whole). Child endpoints of multi-endpoint parents (FGRGBW channels, ZEN52 endpoints 1/2, AEON MultiSensor\'s motion/temp/lux children, etc.) are excluded. For children-of-multi-endpoint-devices use find_device_by_endpoint (by endPointId). HC3 has no native name-filter on /api/devices; this tool fetches the device list (optionally narrowed by roomId) and filters in-process, returning minimal records. Use this instead of get_devices when you have a name and want the id — dramatically smaller payload.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name to search for. Case-insensitive substring match by default.'
            },
            roomId: {
              type: 'number',
              description: 'Optional: only consider devices in this room. Disambiguates common names (e.g. "blind") that recur across rooms.'
            },
            exactMatch: {
              type: 'boolean',
              description: 'If true, require exact name equality (still case-insensitive). Defaults to false (substring match).'
            },
            visibleOnly: {
              type: 'boolean',
              description: 'If true, only return devices where visible === true. Defaults to false.'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'cancel_delayed_action',
        description: 'Cancel a delayed device action that was queued via control_device with a delay value. Wraps DELETE /api/devices/action/{timestamp}/{deviceId}. Pass the Unix epoch timestamp (integer seconds — HC3 truncates) at which the action was scheduled to run, plus the target deviceId. Returns 200 on success or 404 if the pairing doesn\'t match a pending action. Useful for motion-triggered auto-off scenes that need to abort the pending off when new motion re-triggers the light.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: { type: 'number', description: 'Device id the action was queued against' },
            timestamp: { type: 'number', description: 'Unix epoch seconds the action was scheduled for (integer only — HC3 truncates fractional)' }
          },
          required: ['deviceId', 'timestamp']
        }
      },
      {
        name: 'get_device_property',
        description: 'Read a single device property via GET /api/devices/{id}/properties/{propertyName}. Returns {value, modified} — much smaller than get_device_info which hydrates the entire device record (~50 KB for instrumented devices). Use when you need one scalar field repeatedly (e.g. value, batteryLevel, lastBreached). Propagates 404 on unknown deviceId or propertyName. Note: some properties (viewLayout, uiCallbacks) can be large structured values — per-property fetch still helps but not always tiny.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: { type: 'number', description: 'HC3 device id' },
            propertyName: { type: 'string', description: 'Property name (e.g. "value", "batteryLevel", "nodeId", "lastBreached")' }
          },
          required: ['deviceId', 'propertyName']
        }
      },
      {
        name: 'find_device_by_endpoint',
        description: 'Resolve a multi-endpoint child device by its (parentId, endPointId) pair. Stable identity for children that survives Z-Wave re-inclusion: parentId resolves via the parent\'s (stable) name, endPointId is the Z-Wave endpoint number which never shifts. Pairs with find_devices_by_name (for parents). Returns an ARRAY of matching children — endPointId 0 is commonly ambiguous because multi-endpoint parents expose multiple child roles at endpoint 0 (e.g. a ZEN52 parent has both a binarySwitch and a remoteController at endpoint 0). Non-zero endpoints are usually unique. Examples: (4753, 1) → "Patio seating"; (4753, 2) → "Tub lights"; (4753, 0) → ["patio lights" binarySwitch, "patio lights remote" remoteController]. Returns minimal {id, name, type, roomID, visible, enabled, dead, endPointId} records. Fetches /api/devices?parentId={parentId} and filters by properties.endPointId in-process.',
        inputSchema: {
          type: 'object',
          properties: {
            parentId: {
              type: 'number',
              description: 'HC3 device id of the multi-endpoint parent (e.g. the ZEN52 wrapper, the FGRGBW442 master).'
            },
            endpointId: {
              type: 'number',
              description: 'Z-Wave endpoint number. 0 is the primary/root endpoint (often ambiguous), 1..N are the distinct channels/outputs.'
            }
          },
          required: ['parentId', 'endpointId']
        }
      },
      {
        name: 'get_device_info',
        description: 'Get detailed information about a specific device including properties, capabilities, and current state',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'Device ID',
            },
          },
          required: ['deviceId'],
        },
      },
      {
        name: 'control_device',
        description: "Control a device by calling an action (e.g., turnOn, turnOff, setValue, setColor). The `setVariable` action is rejected here — use `set_quickapp_variable` instead, which preserves declared variable types (setVariable via the action endpoint silently coerces numeric-looking strings to numbers and breaks the HC3 UI).",
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'Device ID',
            },
            action: {
              type: 'string',
              description: 'Action to perform (turnOn, turnOff, setValue, setColor, start, stop, etc.)',
            },
            args: {
              type: 'array',
              items: { type: ['string', 'number', 'boolean'] },
              description: 'Arguments for the action (if applicable)',
            },
            delay: {
              type: 'number',
              description: 'Optional: Delay in seconds before executing the action',
            },
          },
          required: ['deviceId', 'action'],
        },
      },
      {
        name: 'modify_device',
        description: "Modify device fields in a single atomic PUT. Use `topLevel` for fields at the device body root (e.g., `name`, `roomID`, `enabled`, `visible`) and `properties` for nested device properties (e.g., `saveLogs`, `icon`, `manufacturer`). At least one must be provided. Writes are verified by refetching and comparing each submitted field; throws on any mismatch rather than silently succeeding. HC3's PUT semantics for nested properties: top-level fields merge, but array-valued properties under `properties.*` (such as `quickAppVariables`, `categories`, `parameters`, `uiCallbacks`) are fully replaced. Submitting a partial array destroys entries not in the submission. `quickAppVariables` is explicitly rejected by this tool — use `set_quickapp_variable` instead. For other array-valued properties, fetch the full current array, modify, and submit the complete modified array.",
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'Device ID',
            },
            topLevel: {
              type: 'object',
              description: 'Top-level device fields to modify (e.g., {name: "New Name", roomID: 5, enabled: true, visible: true}). Sent at the root of the PUT body.',
            },
            properties: {
              type: 'object',
              description: 'Nested device properties to modify (e.g., {saveLogs: false, icon: {...}, manufacturer: "..."}). Sent under properties.* in the PUT body. This is the wrapper HC3 requires for nested updates. Rejected here: quickAppVariables (use set_quickapp_variable); parameters (the PUT path caches without transmitting on firmware 5.x — use set_device_parameter, which wraps the working setConfiguration action); associations / multichannelAssociations (precautionary reject, no verified REST path yet — set via HC3 Web UI). Other array-valued properties like categories / uiCallbacks require the full current array to be submitted (partial submissions destroy omitted entries).',
            },
          },
          required: ['deviceId'],
        },
      },
  ],

  handlers: {
    async get_devices(hc3, args: { roomId?: number; deviceType?: string; interface?: string[] }): Promise<any> {
      let endpoint = '/api/devices';
      const queryParams: string[] = [];

      if (args?.roomId) {
        queryParams.push(`roomID=${args.roomId}`);
      }
      if (args?.deviceType) {
        queryParams.push(`type=${encodeURIComponent(args.deviceType)}`);
      }
      if (args?.interface && args.interface.length > 0) {
        args.interface.forEach(iface => queryParams.push(`interface=${encodeURIComponent(iface)}`));
      }

      if (queryParams.length > 0) {
        endpoint += `?${queryParams.join('&')}`;
      }

      return await hc3.request(endpoint);
    },

    async get_device_info(hc3, args: { deviceId: number }): Promise<any> {
      return await hc3.request(`/api/devices/${args.deviceId}`);
    },

    async cancel_delayed_action(hc3, args: { deviceId: number; timestamp: number }): Promise<any> {
      if (typeof args?.deviceId !== 'number') throw new Error('cancel_delayed_action requires numeric deviceId.');
      if (typeof args?.timestamp !== 'number') throw new Error('cancel_delayed_action requires numeric timestamp.');
      const ts = Math.trunc(args.timestamp);
      await hc3.request(`/api/devices/action/${ts}/${args.deviceId}`, 'DELETE');
      return { cancelled: true, deviceId: args.deviceId, timestamp: ts };
    },

    async get_device_property(hc3, args: { deviceId: number; propertyName: string }): Promise<any> {
      if (typeof args?.deviceId !== 'number') throw new Error('get_device_property requires numeric deviceId.');
      if (typeof args?.propertyName !== 'string' || args.propertyName.length === 0) {
        throw new Error('get_device_property requires a non-empty propertyName.');
      }
      return await hc3.request(`/api/devices/${args.deviceId}/properties/${encodeURIComponent(args.propertyName)}`);
    },

    async find_device_by_endpoint(hc3, args: {
      parentId: number;
      endpointId: number;
    }): Promise<any> {
      if (typeof args?.parentId !== 'number' || typeof args?.endpointId !== 'number') {
        throw new Error('find_device_by_endpoint requires numeric parentId and endpointId.');
      }
      const children: any[] = await hc3.request(`/api/devices?parentId=${args.parentId}`);
      const matches = children.filter(c => c?.properties?.endPointId === args.endpointId);
      return matches.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        roomID: c.roomID,
        visible: c.visible,
        enabled: c.enabled,
        dead: c?.properties?.dead ?? false,
        endPointId: c?.properties?.endPointId ?? null
      }));
    },

    async filter_devices(hc3, args: {
      filters: Array<{ filter: string; value: any[] }>;
      attributes?: string[];
    }): Promise<any> {
      if (!Array.isArray(args?.filters)) {
        throw new Error('filter_devices requires filters array.');
      }
      const body: Record<string, any> = {
        filters: args.filters,
        attributes: { main: args.attributes && args.attributes.length > 0 ? args.attributes : [] }
      };
      return await hc3.request('/api/devices/filter', 'POST', body);
    },

    async find_devices_by_name(hc3, args: {
      name: string;
      roomId?: number;
      exactMatch?: boolean;
      visibleOnly?: boolean;
    }): Promise<any> {
      if (typeof args?.name !== 'string' || args.name.length === 0) {
        throw new Error('find_devices_by_name requires a non-empty name.');
      }
      const needle = args.name.toLowerCase();
      const exact = !!args.exactMatch;
      const visibleOnly = !!args.visibleOnly;

      const endpoint = args.roomId !== undefined
        ? `/api/devices?roomID=${args.roomId}`
        : '/api/devices';
      const devices: any[] = await hc3.request(endpoint);

      const matches = devices.filter(d => {
        const pid = d?.parentId;
        if (pid !== 0 && pid !== 1) return false;
        if (visibleOnly && d?.visible !== true) return false;
        const name: string = typeof d?.name === 'string' ? d.name.toLowerCase() : '';
        return exact ? name === needle : name.includes(needle);
      });

      return matches.map(d => ({
        id: d.id,
        name: d.name,
        roomID: d.roomID,
        type: d.type,
        visible: d.visible,
        enabled: d.enabled,
        dead: d?.properties?.dead ?? false
      }));
    },

    async control_device(hc3, args: { deviceId: number; action: string; args?: any[]; delay?: number }): Promise<any> {
      if (args.action === 'setVariable') {
        throw new Error(
          "control_device does not accept action 'setVariable' — the underlying POST /api/devices/{id}/action/setVariable " +
          "endpoint coerces numeric-looking string values (e.g. '3.0') to numbers while leaving the variable's declared " +
          "type as 'string', which breaks the HC3 web UI (the edit affordance disappears for that row). Use " +
          "set_quickapp_variable instead — it reads the declared type, coerces the value to match, and writes via the " +
          "documented PUT /api/devices/{id} endpoint with post-write verification."
        );
      }
      const device = await hc3.request(`/api/devices/${args.deviceId}`);
      const declared = (device?.actions && typeof device.actions === 'object') ? device.actions : {};
      const declaredNames = Object.keys(declared);
      if (declaredNames.length > 0 && !(args.action in declared)) {
        throw new Error(
          `Device ${args.deviceId} (${device?.name}) does not declare action '${args.action}'. ` +
          `Valid actions for this device: ${declaredNames.sort().join(', ')}. ` +
          `Note: HC3 silently accepts and drops invalid actions on QuickApps with empty actions map, ` +
          `so this pre-check enforces declared actions when present.`
        );
      }

      const endpoint = `/api/devices/${args.deviceId}/action/${encodeURIComponent(args.action)}`;
      const requestData: any = {};

      if (args.args && args.args.length > 0) {
        requestData.args = args.args;
      }

      if (args.delay) {
        requestData.delay = args.delay;
      }

      await hc3.request(endpoint, 'POST', requestData);
      return `Device ${args.deviceId} action '${args.action}' executed successfully.`;
    },

    async modify_device(hc3, args: {
      deviceId: number;
      topLevel?: Record<string, any>;
      properties?: Record<string, any>;
    }): Promise<any> {
      const { deviceId, topLevel, properties } = args;

      if (properties && 'quickAppVariables' in properties) {
        throw new Error(
          'modify_device does not accept quickAppVariables — use set_quickapp_variable to update a single variable, or create / delete / rename via the HC3 UI.'
        );
      }

      if (properties && 'parameters' in properties) {
        throw new Error(
          "modify_device does not accept properties.parameters — on HC3 firmware 5.x the PUT updates HC3's cached copy of the Z-wave configuration but does not transmit to the device (verified against a Zooz ZEN52: cache updated, HC3 reported success, device behaviour unchanged). Use set_device_parameter, which wraps the `setConfiguration` device action — the working REST path for Z-wave parameter writes on this firmware (the documented `setParameter` and `reconfigure` actions return 'not implemented'). To inspect what HC3 has currently stored for this device's parameters (with labels, descriptions, defaults, and format), call get_device_parameters(deviceId)."
        );
      }

      if (properties && ('associations' in properties || 'multichannelAssociations' in properties)) {
        throw new Error(
          "modify_device does not accept properties.associations or properties.multichannelAssociations — precautionary reject based on the S14 finding (the structurally identical properties.parameters PUT caches without transmitting on this firmware). For parameters specifically, the `setConfiguration` action was later confirmed to transmit and is exposed as set_device_parameter; no equivalent working REST path has been verified for associations. Set associations via the HC3 Web UI until a transmitting path is found."
        );
      }

      const topLevelKeys = topLevel ? Object.keys(topLevel) : [];
      const propertiesKeys = properties ? Object.keys(properties) : [];
      if (topLevelKeys.length === 0 && propertiesKeys.length === 0) {
        throw new Error(
          'modify_device requires at least one of topLevel or properties with at least one field.'
        );
      }

      const body: Record<string, any> = {};
      if (topLevelKeys.length > 0) {
        Object.assign(body, topLevel);
      }
      if (propertiesKeys.length > 0) {
        body.properties = { ...properties };
      }

      await hc3.request(`/api/devices/${deviceId}`, 'PUT', body);
      const after = await hc3.request(`/api/devices/${deviceId}`);
      verifyWrite(topLevel, properties, after, `device ${deviceId}`);

      const submittedSummary: Record<string, any> = {};
      if (topLevelKeys.length > 0) submittedSummary.topLevel = topLevel;
      if (propertiesKeys.length > 0) submittedSummary.properties = properties;
      return {
        deviceId,
        submitted: submittedSummary,
        verified: true
      };
    },

    async delete_device(hc3, args: { deviceId: number; cascade?: boolean; allow_physical?: boolean }): Promise<any> {
      if (typeof args?.deviceId !== 'number') {
        throw new Error('delete_device requires numeric deviceId.');
      }
      if (args.deviceId < 10) {
        throw new Error(
          `delete_device refuses deviceId ${args.deviceId}: ids < 10 are reserved HC3 system devices.`
        );
      }

      const device: any = await hc3.request(`/api/devices/${args.deviceId}`);
      const interfaces: string[] = Array.isArray(device?.interfaces) ? device.interfaces : [];
      const isQuickApp = interfaces.includes('quickApp');
      const isPlugin = !!device?.isPlugin;
      const isZwave = interfaces.includes('zwave');

      if (isZwave && !isQuickApp && !args.allow_physical) {
        throw new Error(
          `delete_device refuses device ${args.deviceId} (${device.name}): it is a Z-Wave physical device (interfaces=${JSON.stringify(interfaces)}). ` +
          `REST delete skips mesh exclusion and leaves a ghost node on the controller. Exclude via the HC3 Web UI, or pass allow_physical=true to override.`
        );
      }
      if (!isQuickApp && !isPlugin && !args.allow_physical) {
        throw new Error(
          `delete_device refuses device ${args.deviceId} (${device.name}): not a QuickApp and not an explicitly-installed plugin (isPlugin=${isPlugin}, interfaces=${JSON.stringify(interfaces)}). Pass allow_physical=true to override.`
        );
      }

      const children: any[] = await hc3.request(`/api/devices?parentId=${args.deviceId}`);
      if (children.length > 0 && !args.cascade) {
        const childSummary = children.slice(0, 10).map(c => `${c.id} (${c.name})`).join(', ');
        throw new Error(
          `delete_device refuses device ${args.deviceId} (${device.name}): has ${children.length} children. ` +
          `HC3 will delete them silently. Pass cascade=true to proceed. Children: ${childSummary}${children.length > 10 ? ', …' : ''}`
        );
      }

      await hc3.request(`/api/devices/${args.deviceId}`, 'DELETE');

      try {
        await hc3.request(`/api/devices/${args.deviceId}`);
        throw new Error(
          `delete_device: post-delete verify failed — device ${args.deviceId} still exists after DELETE.`
        );
      } catch (e: any) {
        if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
      }

      return {
        deleted: args.deviceId,
        name: device.name,
        type: device.type,
        wasQuickApp: isQuickApp,
        wasPlugin: isPlugin,
        childrenRemovedWith: children.length > 0
          ? children.map(c => ({ id: c.id, name: c.name }))
          : []
      };
    },
  },
};
