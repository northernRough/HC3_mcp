// System / utility tools — system info, network, energy, weather,
// home status, location, diagnostics, refreshStates and event history.
//
// Schemas are also exposed by name as `systemSchemas.<tool>` because
// the legacy tools/list ordering interleaves system tools with
// zwave-diagnostics tools at scattered positions; the server
// references each schema individually at its tools/list slot to
// preserve byte-equivalent ordering.

import { ToolModule } from './registry';
import { MCPTool } from '../types';
import { deepMerge, verifyWrite } from '../util';

export const systemSchemas: Record<string, MCPTool> = {
  get_system_info:
      {
        name: 'get_system_info',
        description: 'Get Fibaro HC3 system information including version, serial number, and status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
  get_network_status:
      {
        name: 'get_network_status',
        description: 'Get network configuration and status information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
  get_energy_data:
      {
        name: 'get_energy_data',
        description: 'Get energy consumption data for devices or the entire system',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'Optional: Specific device ID to get energy data for',
            },
          },
        },
      },
  get_diagnostics:
      {
        name: 'get_diagnostics',
        description: 'Get system diagnostic information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
  get_refresh_states:
      {
        name: 'get_refresh_states',
        description: 'Poll HC3\'s native event/state-change stream via GET /api/refreshStates?last={cursor}. Returns the `changes` delta (current device state snapshot for first call; only changed devices on subsequent calls) and the `events` list (discrete events since last cursor — scene starts, device actions, central scene button presses, etc.), plus a new `last` cursor to pass to the next call. This is the underlying mechanism HC3 QuickApps use for refreshStates-based event subscriptions. HC3 long-polls with up to ~30s block if no new events — expect a brief wait when everything is quiet. FIRST CALL (last=0 or omitted): returns a full snapshot, potentially hundreds of change entries. SUBSEQUENT CALLS (with prior last): incremental, usually small. Complementary to get_event_history: refreshStates is live poll; event_history is retrospective query.',
        inputSchema: {
          type: 'object',
          properties: {
            last: {
              type: 'number',
              description: 'Cursor from a previous call. Omit or 0 for a full snapshot. Use the `last` field from the previous response to continue polling incrementally.'
            }
          }
        }
      },
  get_event_history:
      {
        name: 'get_event_history',
        description: 'Fetch recent HC3 system events: scene starts, device property changes (state/value/power/etc), device actions, and other gateway events. This is the feed behind the /app/history page and the primary tool for answering "what just happened?" on the HC3. Complements get_debug_messages (QA/scene debug logs), get_notifications (user-facing notifications) and get_alarm_history (alarm-only events). Returns events newest-first.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum events to return. Default 30, capped at 1000 client-side to prevent hangs (HC3 has no server-side cap and large requests time out).'
            },
            event_type: {
              type: 'string',
              description: 'Filter to one event type. Case-sensitive exact match — typos return an empty array silently. Examples: "SceneStartedEvent", "DevicePropertyUpdatedEvent", "DeviceActionRanEvent", "CentralSceneEvent".'
            },
            object_id: {
              type: 'number',
              description: 'Filter to events for a specific object (usually device or scene id). Requires object_type to narrow correctly.'
            },
            object_type: {
              type: 'string',
              description: 'Object type for object_id filter (e.g. "device", "scene").'
            },
            since_timestamp: {
              type: 'number',
              description: 'Unix epoch seconds; return only events whose timestamp >= this value. Filtered client-side after fetch (HC3 silently ignores server-side time params on this endpoint). For a time window, fetch with a large limit then rely on this filter.'
            }
          },
        },
      },
  get_weather:
      {
        name: 'get_weather',
        description: 'Get current weather information and forecast',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
  get_home_status:
      {
        name: 'get_home_status',
        description: 'Get current home/away status and location information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
  set_home_status:
      {
        name: 'set_home_status',
        description: 'Set home/away status',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Home status (Home, Away, Night, Vacation)',
              enum: ['Home', 'Away', 'Night', 'Vacation'],
            },
          },
          required: ['status'],
        },
      },
  get_location_info:
      {
        name: 'get_location_info',
        description: 'Get location and geofencing information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
  update_location_settings:
      {
        name: 'update_location_settings',
        description: 'Update a single location/geofence by ID in a verified PUT. Fetches the current location, deep-merges submitted `fields` into it, and PUTs the full merged object to /api/panels/location/{id}. Writes are verified by refetching and comparing each submitted field; throws on any mismatch rather than silently succeeding. Read-only fields (`id`, `created`, `modified`) are rejected if submitted. Get the full list of configured locations with `get_location_info` first to find the ID you want to edit.',
        inputSchema: {
          type: 'object',
          properties: {
            locationId: {
              type: 'number',
              description: 'ID of the location/geofence to update (from get_location_info)',
            },
            fields: {
              type: 'object',
              description: 'Fields to update (e.g. {name: "Home", latitude: 51.1, longitude: -0.77, radius: 500, address: "..."}). Submitted fields are deep-merged into the current location; unspecified fields are preserved. Read-only fields (id, created, modified) will be rejected.',
            },
          },
          required: ['locationId', 'fields'],
        },
      },
};

export const system: ToolModule = {
  schemas: Object.values(systemSchemas),

  handlers: {
    async get_system_info(hc3): Promise<any> {
      return await hc3.request('/api/settings/info');
    },

    async get_network_status(hc3): Promise<any> {
      return await hc3.request('/api/settings/network');
    },

    async get_energy_data(hc3, args: { deviceId?: number }): Promise<any> {
      if (args?.deviceId) {
        return await hc3.request(`/api/energy/${args.deviceId}`);
      } else {
        return await hc3.request('/api/energy');
      }
    },

    async get_diagnostics(hc3): Promise<any> {
      return await hc3.request('/api/diagnostics');
    },

    async get_refresh_states(hc3, args: { last?: number }): Promise<any> {
      const last = typeof args?.last === 'number' ? args.last : 0;
      return await hc3.request(`/api/refreshStates?last=${last}&lang=en`);
    },

    async get_event_history(hc3, args: {
      limit?: number;
      event_type?: string;
      object_id?: number;
      object_type?: string;
      since_timestamp?: number;
    }): Promise<any> {
      const cappedLimit = Math.min(args?.limit ?? 30, 1000);
      const params = new URLSearchParams();
      params.set('numberOfRecords', String(cappedLimit));
      if (args?.event_type) params.set('eventType', args.event_type);
      if (args?.object_id !== undefined) params.set('objectId', String(args.object_id));
      if (args?.object_type) params.set('objectType', args.object_type);
      const events: any[] = await hc3.request(`/api/events/history?${params.toString()}`);
      if (args?.since_timestamp !== undefined) {
        return events.filter(e => (e?.timestamp ?? 0) >= args.since_timestamp!);
      }
      return events;
    },

    async get_weather(hc3): Promise<any> {
      return await hc3.request('/api/weather');
    },

    async get_home_status(hc3): Promise<any> {
      return await hc3.request('/api/panels/location');
    },

    async set_home_status(hc3, args: { status: string }): Promise<any> {
      const validModes = ['Home', 'Away', 'Night', 'Vacation'];
      if (!validModes.includes(args.status)) {
        throw new Error(`set_home_status: invalid status '${args.status}'. Must be one of: ${validModes.join(', ')}.`);
      }
      await hc3.request('/api/panels/location', 'PUT', { mode: args.status });
      return `Home status set to '${args.status}' successfully.`;
    },

    async get_location_info(hc3): Promise<any> {
      return await hc3.request('/api/panels/location');
    },

    async update_location_settings(hc3, args: {
      locationId: number;
      fields: Record<string, any>;
    }): Promise<any> {
      const { locationId, fields } = args;

      if (!fields || Object.keys(fields).length === 0) {
        throw new Error(
          'update_location_settings requires fields with at least one key.'
        );
      }

      const readOnly = ['id', 'created', 'modified'];
      const submittedReadOnly = Object.keys(fields).filter(k => readOnly.includes(k));
      if (submittedReadOnly.length > 0) {
        throw new Error(
          `update_location_settings cannot change read-only fields: ${submittedReadOnly.join(', ')}.`
        );
      }

      const current = await hc3.request(`/api/panels/location/${locationId}`);
      const merged = deepMerge(current, fields);
      await hc3.request(`/api/panels/location/${locationId}`, 'PUT', merged);
      const after = await hc3.request(`/api/panels/location/${locationId}`);
      verifyWrite(fields, undefined, after, `location ${locationId}`);

      return {
        locationId,
        submitted: { fields },
        verified: true
      };
    },
  },
};
