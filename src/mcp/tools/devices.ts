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
import { isNotFound } from '../hc3-client';
import { validateViewLayout, describeViewLayoutProblems } from '../viewlayout';

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

/** Where `function <Class>:<method>(` is defined in a QuickApp's files, as
 *  "file:line", or undefined. */
export async function findQuickAppMethod(hc3: any, qaId: number, method: string): Promise<string | undefined> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(method)) return undefined;
  const re = new RegExp(`function\\s+[A-Za-z_][\\w.]*\\s*:\\s*${method}\\s*\\(`);
  let files: any[] = [];
  try { files = (await hc3.request(`/api/quickApp/${qaId}/files`)) ?? []; } catch { return undefined; }
  for (const f of files) {
    let content = '';
    try { content = (await hc3.request(`/api/quickApp/${qaId}/files/${encodeURIComponent(f.name)}`))?.content ?? ''; } catch { continue; }
    const lines = content.split('\n');
    const i = lines.findIndex(l => re.test(l));
    if (i >= 0) return `${f.name}:${i + 1}`;
  }
  return undefined;
}

/** Pick top-level fields and "properties.X" paths from a device record. */
export function projectDevice(d: any, attrs: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const a of attrs) {
    if (a === 'properties') out.properties = d?.properties ?? {};
    else if (a.startsWith('properties.')) {
      const k = a.slice('properties.'.length);
      (out.properties ??= {})[k] = d?.properties?.[k];
    } else out[a] = d?.[a];
  }
  return out;
}

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
                  filter: { type: 'string', description: 'Filter key, e.g. "deviceID", "enabled", "roomID", "type", "hasProperty", "hasNoProperty". hasNoProperty is evaluated by this tool (HC3\'s own returns nothing): a device matches if it lacks EVERY listed property.' },
                  value: { type: 'array', description: 'Values to match. Arrays of strings, numbers, or booleans.' }
                },
                required: ['filter', 'value']
              }
            },
            attributes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Attribute names to return per device, e.g. ["id", "name", "roomID", "type", "properties.value"]. Top-level fields, "properties" (the whole object) or "properties.<name>". OMIT to get ids only (that is what HC3 returns), not full records.'
            }
          },
          required: ['filters']
        }
      },
      {
        name: 'find_devices_by_name',
        description: 'Resolve a human-readable device name to one or more HC3 devices. Case-insensitive substring match by default (exactMatch:true for equality). Searches EVERY device, including Z-Wave endpoint children, which is where most controllable devices live (a dimmer channel, a sensor\'s motion child); each result carries parentId so you can tell a node from its endpoints. Until 4.35.0 only top-level devices (parentId 0 or 1) were searched, so an exactly-named endpoint child came back as [] and read as "no such device". Pass topLevelOnly:true for the old behaviour. HC3 has no native name-filter on /api/devices; this tool fetches the device list (optionally narrowed by roomId) and filters in-process, returning minimal records. Use this instead of get_devices when you have a name and want the id — dramatically smaller payload.',
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
            },
            topLevelOnly: {
              type: 'boolean',
              description: 'If true, only top-level devices (parentId 0 or 1: QuickApps, controllers, whole Z-Wave nodes). Defaults to false: endpoint children are searched too.'
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
        description: 'Read a single device property via GET /api/devices/{id}/properties/{propertyName}. Returns {value, modified} — much smaller than get_device_info which hydrates the entire device record (~50 KB for instrumented devices). Use when you need one scalar field repeatedly (e.g. value, batteryLevel, lastBreached). On a 404 it re-reads the device to say WHICH thing is missing: an unknown deviceId is reported as such, an unknown propertyName is reported with the list of properties the device does expose. Note: some properties (viewLayout, uiCallbacks) can be large structured values — per-property fetch still helps but not always tiny.',
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
        description: "Modify device fields in a single atomic PUT. Use `topLevel` for fields at the device body root (e.g., `name`, `roomID`, `enabled`, `visible`) and `properties` for nested device properties (e.g., `saveLogs`, `icon`, `manufacturer`). At least one must be provided. Writes are verified by refetching and comparing each submitted field; throws on any mismatch rather than silently succeeding. HC3's PUT semantics for nested properties: top-level fields merge, but array-valued properties under `properties.*` (such as `quickAppVariables`, `categories`, `parameters`, `uiCallbacks`) are fully replaced. Submitting a partial array destroys entries not in the submission. `quickAppVariables` is explicitly rejected by this tool — use `set_quickapp_variable` for one, or `set_quickapp_variables` for several in a single write (one restart). For other array-valued properties, fetch the full current array, modify, and submit the complete modified array.\n\n**Building or fixing a QuickApp tile? Call get_hc3_quickapp_programming_guide({topic:\"ui\"}) first** — the two sections below are the parts that concern this tool, and the guide carries the rest of the lifecycle in order.\n\n**QuickApp `viewLayout` (verified on 5.210.12).** An externally-PUT viewLayout DOES render — a QuickApp does not need to install its own view from Lua. But a malformed `select` takes the WHOLE tile with it, not just that element: HC3 stores the layout, this tool reports verified, and `/plugins/getView` then returns an empty item list with every other component gone. Two silent triggers: a `select` without `selectionType` ('single' or 'multi'), which is required on EVERY select in the layout; or `values` supplied as a JSON object rather than an array — in Lua `values = {}` encodes as `{}` not `[]`, so use `json.array()` (same for `selectedItems` when clearing a multi-select). After any viewLayout write, read back get_plugin_view and confirm the components are present: a verified write here does not mean a rendered tile.\n\n**Restoring named `uiCallbacks` (verified end to end on 5.210.12).** `create_quickapp` cannot keep them — HC3 rewrites `{name:\"modeSelector\", eventType:\"onToggled\", callback:\"modeSelection\"}` into `{eventType:\"onReleased\", callback:\"uimodeSelectorOnReleased\"}` at creation. Writing the named array back through THIS tool afterwards does stick: it survives a later `update_multiple_quickapp_files` push with the `uiCallbacks` modified timestamp unchanged, and **no restart is needed** for the new binding to take effect (measured; a restart was long assumed necessary and is not). **But a stuck name is not a dispatched name.** Firing the element with `call_ui_event` dispatches the named method with `{eventType, elementName, values, deviceId}` — while a real tap in the app dispatches **`UIAction`, positionally**, ignoring the name entirely. That difference was measured on 5.210.12 by `scripts/probe-uicallbacks.mjs`; this description previously stated only the `call_ui_event` half, which reads as an end-to-end guarantee and is not one. Write the names back if you want them, but handle the event in `UIAction` too, or the tile will be dead under a finger while testing green. `uiCallbacks` is array-valued, so submit the complete array — a partial one destroys the entries you leave out. Then read it back (get_device_info) and confirm: the read is cheap and the failure mode is silent.",
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
              description: 'Nested device properties to modify (e.g., {saveLogs: false, icon: {...}, manufacturer: "..."}). Sent under properties.* in the PUT body. This is the wrapper HC3 requires for nested updates. Rejected here: quickAppVariables (use set_quickapp_variable, or set_quickapp_variables for several at once); parameters (the PUT path caches without transmitting on firmware 5.x — use set_device_parameter, which wraps the working setConfiguration action); associations / multichannelAssociations (precautionary reject, no verified REST path yet — set via HC3 Web UI). Other array-valued properties like categories / uiCallbacks require the full current array to be submitted (partial submissions destroy omitted entries).',
            },
            allowUnsafeViewLayout: {
              type: 'boolean',
              description: 'Write a viewLayout even though its selects fail validation. Default false. The refusal exists because HC3 accepts a malformed select, this tool\'s post-write verify passes, and the tile then renders empty — so the write reports success while the device shows nothing. Only set this if you intend to inspect get_plugin_view afterwards.',
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
      try {
        return await hc3.request(`/api/devices/${args.deviceId}`);
      } catch (e: any) {
        if (!isNotFound(e)) throw e;
        throw new Error(`get_device_info: no device ${args.deviceId} on this HC3. Find the right id with find_devices_by_name or get_devices.`);
      }
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
      try {
        return await hc3.request(`/api/devices/${args.deviceId}/properties/${encodeURIComponent(args.propertyName)}`);
      } catch (e: any) {
        if (!isNotFound(e)) throw e;
        // A 404 here is two different problems wearing the same status, and
        // HC3 sends no body to separate them. This was the single largest
        // cluster in the friction log — 29 entries reading only "HTTP 404:
        // Not Found", against which nobody could say whether the device or
        // the property was the missing one. One extra read, on the failure
        // path only, settles it and names what does exist.
        let device: any;
        try {
          device = await hc3.request(`/api/devices/${args.deviceId}`);
        } catch (inner: any) {
          if (isNotFound(inner)) {
            throw new Error(
              `get_device_property: no device ${args.deviceId} on this HC3. Find the right id with find_devices_by_name or get_devices.`
            );
          }
          throw e;
        }
        if (device && args.propertyName in device && !(args.propertyName in (device.properties ?? {}))) {
          // interfaces, parentId, roomID, name... live at the record's root.
          throw new Error(
            `get_device_property: '${args.propertyName}' is a top-level field of device ${args.deviceId}, not a property. ` +
            `Its value is ${JSON.stringify(device[args.propertyName])}. Use get_device_info for top-level fields.`
          );
        }
        const names = Object.keys(device?.properties ?? {}).sort();
        const shown = names.slice(0, 40).join(', ');
        const more = names.length > 40 ? `, +${names.length - 40} more` : '';
        throw new Error(
          `get_device_property: device ${args.deviceId} (${device?.name}) has no property '${args.propertyName}'. ` +
          `It exposes ${names.length}: ${shown}${more}.`
        );
      }
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
      // A null value makes HC3 answer 400 "Invalid JSON: get_value<string>
      // called on null Value", which names neither the filter nor the field.
      for (const f of args.filters) {
        if (!f || typeof f.filter !== 'string' || !Array.isArray(f.value) || f.value.some((v: any) => v === null || v === undefined)) {
          throw new Error(`filter_devices: every filter must be {filter: string, value: [non-null values]}; got ${JSON.stringify(f)}.`);
        }
      }
      // HC3's own hasNoProperty filter is broken: it returns NO devices in any
      // combination (13 Nov 2026: 0 returned, 827 of 1008 devices actually
      // lack 'power'; hasProperty is fine at 181). A silent empty result reads
      // as "none lack it". Evaluate it here instead.
      const clientSide = args.filters.filter(f => f.filter === 'hasNoProperty');
      const serverSide = args.filters.filter(f => f.filter !== 'hasNoProperty');
      const attrs = args.attributes ?? [];
      // HC3 also drops property attributes ("properties.value", "properties")
      // silently, returning id/name only. Project those here too.
      const wantsProps = attrs.some(a => a === 'properties' || a.startsWith('properties.'));

      if (clientSide.length === 0 && !wantsProps) {
        const body: Record<string, any> = { filters: serverSide, attributes: { main: attrs } };
        return await hc3.request('/api/devices/filter', 'POST', body);
      }

      // Server narrows by everything it handles correctly; we do the rest.
      let ids: Set<number> | null = null;
      if (serverSide.length) {
        const hits: any[] = await hc3.request('/api/devices/filter', 'POST', { filters: serverSide, attributes: { main: ['id'] } });
        ids = new Set((hits ?? []).map(h => h.id));
      }
      const all: any[] = await hc3.request('/api/devices');
      const lacking = clientSide.flatMap(f => f.value.map(String));
      const matched = all.filter(d =>
        (ids === null || ids.has(d.id)) &&
        lacking.every(prop => !(d?.properties && prop in d.properties)));
      return matched.map(d => projectDevice(d, attrs.length ? attrs : ['id']));
    },

    async find_devices_by_name(hc3, args: {
      name: string;
      roomId?: number;
      exactMatch?: boolean;
      visibleOnly?: boolean;
      topLevelOnly?: boolean;
    }): Promise<any> {
      if (typeof args?.name !== 'string' || args.name.length === 0) {
        throw new Error('find_devices_by_name requires a non-empty name.');
      }
      const topLevelOnly = args.topLevelOnly === true;
      const needle = args.name.toLowerCase();
      const exact = !!args.exactMatch;
      const visibleOnly = !!args.visibleOnly;

      const endpoint = args.roomId !== undefined
        ? `/api/devices?roomID=${args.roomId}`
        : '/api/devices';
      const devices: any[] = await hc3.request(endpoint);

      const matches = devices.filter(d => {
        const pid = d?.parentId;
        if (topLevelOnly && pid !== 0 && pid !== 1) return false;
        if (visibleOnly && d?.visible !== true) return false;
        const name: string = typeof d?.name === 'string' ? d.name.toLowerCase() : '';
        return exact ? name === needle : name.includes(needle);
      });

      return matches.map(d => ({
        id: d.id,
        name: d.name,
        parentId: d.parentId,
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
      let foundInSource: string | undefined;
      if (declaredNames.length > 0 && !(args.action in declared)) {
        // HC3 dispatches ANY method of a QuickApp, declared or not, so refusing
        // every undeclared action blocked real methods (dumpCapabilities on the
        // Daikin QA, 17 Oct). But it silently drops a method that does not
        // exist, so allowing everything would hide typos. Look for the method
        // in the QuickApp's own Lua (the parent's, for a child) and decide.
        const ifaces: string[] = Array.isArray(device?.interfaces) ? device.interfaces : [];
        const isQA = ifaces.includes('quickApp');
        const isChild = ifaces.includes('quickAppChild') && device?.parentId > 1;
        if (isQA || isChild) {
          foundInSource = await findQuickAppMethod(hc3, isQA ? args.deviceId : device.parentId, args.action);
        }
        if (!foundInSource) {
          throw new Error(
            `Device ${args.deviceId} (${device?.name}) does not declare action '${args.action}'` +
            (isQA || isChild ? `, and no \`function <Class>:${args.action}(\` exists in its QuickApp's source` : '') + `. ` +
            `Valid actions for this device: ${declaredNames.sort().join(', ')}. ` +
            `HC3 silently accepts and drops an action that does not exist, so this check is the only signal you would get.`
          );
        }
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
      if (foundInSource) {
        return `Device ${args.deviceId}: '${args.action}' is not a declared action, but it is defined in the QuickApp's source ` +
          `(${foundInSource}), so it was dispatched. HC3 gives no delivery receipt for QuickApp methods; check get_debug_messages for its effect.`;
      }
      return `Device ${args.deviceId} action '${args.action}' executed successfully.`;
    },

    async modify_device(hc3, args: {
      deviceId: number;
      topLevel?: Record<string, any>;
      properties?: Record<string, any>;
      allowUnsafeViewLayout?: boolean;
    }): Promise<any> {
      const { deviceId } = args;
      // Some clients send an object argument as a JSON string. That reached
      // `'quickAppVariables' in properties` and crashed with "Cannot use 'in'
      // operator to search for 'quickAppVariables' in {...}" (friction, 1 Nov).
      const asObject = (v: any, field: string): Record<string, any> | undefined => {
        if (v === undefined || v === null) return undefined;
        if (typeof v === 'string') {
          try { v = JSON.parse(v); } catch {
            throw new Error(`modify_device: \`${field}\` must be an object; got a string that is not JSON.`);
          }
        }
        if (typeof v !== 'object' || Array.isArray(v)) {
          throw new Error(`modify_device: \`${field}\` must be an object of fields to set; got ${Array.isArray(v) ? 'an array' : typeof v}.`);
        }
        return v;
      };
      const topLevel = asObject(args.topLevel, 'topLevel');
      const properties = asObject(args.properties, 'properties');

      if (properties && 'quickAppVariables' in properties) {
        throw new Error(
          'modify_device does not accept quickAppVariables — use set_quickapp_variable (or set_quickapp_variables for several, one restart) to update, create_quickapp_variable to add, or delete_quickapp_variable to remove a single variable. Rename via the HC3 UI.'
        );
      }

      if (properties && 'parameters' in properties) {
        throw new Error(
          "modify_device does not accept properties.parameters — on HC3 firmware 5.x the PUT updates HC3's cached copy of the Z-wave configuration but does not transmit to the device (verified against a Zooz ZEN52: cache updated, HC3 reported success, device behaviour unchanged). Use set_device_parameter, which wraps the `setConfiguration` device action — the working REST path for Z-wave parameter writes on this firmware (the documented `setParameter` and `reconfigure` actions return 'not implemented'). To inspect what HC3 has currently stored for this device's parameters (with labels, descriptions, defaults, and format), call get_device_parameters(deviceId)."
        );
      }

      if (properties && 'wakeUpTime' in properties) {
        throw new Error(
          "modify_device does not accept properties.wakeUpTime — on a Z-Wave battery node it is a stale copy, not the node's setting (15 Nov 2026, FGMS001: the record read 43200 while the sensor woke every 300 s). Use set_wake_up_interval, which queues the change through HC3's Z-Wave engine the way the web UI does, and get_wake_up to read the real interval."
        );
      }

      if (properties && ('associations' in properties || 'multichannelAssociations' in properties)) {
        throw new Error(
          "modify_device does not accept properties.associations or properties.multichannelAssociations — precautionary reject based on the S14 finding (the structurally identical properties.parameters PUT caches without transmitting on this firmware). For parameters specifically, the `setConfiguration` action was later confirmed to transmit and is exposed as set_device_parameter; no equivalent working REST path has been verified for associations. Set associations via the HC3 Web UI until a transmitting path is found."
        );
      }

      // A malformed select is verified-bad, not merely suspicious: HC3 accepts
      // it, this tool's own post-write verify passes, and the tile then renders
      // empty with nothing reporting a fault. Refuse rather than hand back a
      // "verified" that the gateway will quietly contradict.
      if (properties && properties.viewLayout !== undefined && args.allowUnsafeViewLayout !== true) {
        const problems = validateViewLayout(properties.viewLayout);
        if (problems.length > 0) {
          throw new Error(
            `modify_device refuses this viewLayout: ${problems.length} select problem(s) that HC3 ` +
            `accepts silently and then renders as an EMPTY tile (verified on 5.210.12 — every other ` +
            `component disappears too, not just the offending one).\n` +
            describeViewLayoutProblems(problems) + '\n' +
            `Nothing was written. Fix the select(s), or pass allowUnsafeViewLayout=true to write anyway ` +
            `and then check get_plugin_view to see what actually rendered.`
          );
        }
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

      try {
        await hc3.request(`/api/devices/${deviceId}`, 'PUT', body);
      } catch (e: any) {
        if (!isNotFound(e)) throw e;
        // HC3 answers 404 for a device that EXISTS when it refuses one of the
        // fields, which reads as "wrong id" and sends callers checking ids.
        let dev: any = null;
        try { dev = await hc3.request(`/api/devices/${deviceId}`); } catch (inner: any) { if (!isNotFound(inner)) throw e; }
        if (!dev) {
          throw new Error(`modify_device: no device ${deviceId} on this HC3. Find the right id with find_devices_by_name or get_devices.`);
        }
        const fields = [...topLevelKeys.map(k => `topLevel.${k}`), ...propertiesKeys.map(k => `properties.${k}`)];
        const known: string[] = [];
        if (topLevelKeys.includes('type')) known.push('`type` cannot be changed after creation (HC3 404s it; create a new device instead)');
        if (propertiesKeys.includes('viewLayout') && dev.parentId && dev.parentId > 1) {
          known.push('a QuickApp CHILD takes its custom UI as `uiView`, not `viewLayout` (HC3 404s viewLayout on children)');
        }
        throw new Error(
          `modify_device: device ${deviceId} (${dev.name}) exists, but HC3 answered 404 to the write: it refused one of ` +
          `${fields.join(', ')}. Nothing was written.` +
          (known.length ? ` Known cause: ${known.join('; ')}.` : ' Write the fields one at a time to find which.')
        );
      }
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

      // HC3 deletes asynchronously, child devices especially: a GET straight
      // after the DELETE can still find the device, then 404 a moment later.
      // Checking once reported failure on deletes that had worked (5070,
      // 5071, 5072 on 1 and 8 Nov), which invites a retry or a false
      // "cannot delete". Poll for up to ~6 s before calling it a failure.
      let stillExists = true;
      for (const waitMs of [0, 500, 1000, 1500, 3000]) {
        if (waitMs) await new Promise(r => setTimeout(r, waitMs));
        try {
          await hc3.request(`/api/devices/${args.deviceId}`);
        } catch (e: any) {
          if (!isNotFound(e)) throw e;
          stillExists = false;
          break;
        }
      }
      if (stillExists) {
        throw new Error(
          `delete_device: post-delete verify failed — device ${args.deviceId} still exists 6 s after DELETE.`
        );
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
