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
import { SERVER_NAME, SERVER_VERSION } from '../version';

export const systemSchemas: Record<string, MCPTool> = {
  get_server_info:
      {
        name: 'get_server_info',
        description: 'Report the MCP server\'s identity: package name, version (read from package.json at startup so it stays in sync with the shipped tarball), transport (stdio or http), and the HC3 host the server is configured to talk to. Useful for "which version of the MCP am I connected to" and "which HC3 is this MCP wired to" questions without needing to inspect the initialize handshake. No HC3 round-trip; reports local server state only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
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
        description:
          'Energy data. With no args, returns { summary, meterDevices } — system-wide ' +
          'current-billing-period totals and the list of energy-metering devices for ' +
          'follow-up queries. With deviceId, returns the device\'s energy-meter ' +
          'registration row from /api/energy/devices. Per-device historical energy ' +
          'data is not exposed via REST on current HC3 firmware (the legacy ' +
          '/api/energy/{id}/... 9-segment path is dead, and /api/energy itself ' +
          'returns HTTP 500).',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'Optional: a device id. If provided, returns its energy-meter registration row from /api/energy/devices, or an explanatory error if the device exists but is not metered.',
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
        description: 'Fetch HC3 system events: scene starts, device property changes (state/value/power/etc), device actions, and other gateway events. This is the feed behind the /app/history page and the primary tool for answering "what happened?" on the HC3 — both "what just happened?" and retrospective "did the watering scene fire zones X, Y, Z this morning between 06:00 and 10:00?" queries. Complements get_debug_messages (QA/scene debug logs), get_notifications (user-facing notifications) and get_alarm_history (alarm-only events). Returns events newest-first. The from/to time window is forwarded to HC3 server-side (so a retrospective window reaches arbitrarily far back, not just the most recent N events); the object_id(s) filter is enforced client-side against each event\'s objects[].id (HC3 silently ignores objectId unless objectType is also supplied, and has no server-side filter for a set of ids), so you can bound a query in time and scope it to a set of devices in one call.',
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
              description: 'Filter to events for a single object (a device or scene id), matched client-side against the event\'s objects[].id. For several objects use object_ids instead. Pairing with object_type additionally lets HC3 narrow (and page back through history) server-side — useful for a quiet device over a long span.'
            },
            object_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Filter to events for a SET of objects (e.g. several device ids). Enforced client-side against each event\'s objects[].id, so it works regardless of object_type (HC3 has no server-side filter for a set of ids). Merged with object_id if both are given. For a precise set over a long history, also pass from/to to bound the window.'
            },
            object_type: {
              type: 'string',
              description: 'Optional object type ("device", "scene", …). With a single object_id it lets HC3 narrow server-side (its objectId filter is silently ignored without objectType); the client-side id filter does not require it.'
            },
            from: {
              type: 'number',
              description: 'Unix epoch seconds; lower time bound (inclusive). Forwarded to HC3 server-side so retrospective windows reach arbitrarily far back, not just the most recent N events.'
            },
            to: {
              type: 'number',
              description: 'Unix epoch seconds; upper time bound (inclusive). Forwarded to HC3 server-side. Combine with from to bound a window, e.g. this morning 06:00–10:00.'
            },
            since_timestamp: {
              type: 'number',
              description: 'Deprecated alias for from (lower bound, Unix epoch seconds). Use from/to instead. If from is also supplied, from wins.'
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
    async get_server_info(hc3): Promise<any> {
      return {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        transport: (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase(),
        hc3Host: hc3.config.host ?? null,
        hc3Port: hc3.config.port ?? null,
      };
    },

    async get_system_info(hc3): Promise<any> {
      return await hc3.request('/api/settings/info');
    },

    async get_network_status(hc3): Promise<any> {
      return await hc3.request('/api/settings/network');
    },

    async get_energy_data(hc3, args: { deviceId?: number }): Promise<any> {
      // /api/energy and /api/energy/{id} are both dead on current firmware (5.20x).
      // The legacy 9-segment path /api/energy/{id}/{measure}/{interval}/{y1}/{m1}/{d1}/{y2}/{m2}/{d2}
      // is rejected ("path: 9 arguments") on every form tested. /api/energy returns 500.
      // Per-device historical energy data is not exposed via REST on current firmware.
      // The only working endpoints are /api/energy/devices and /api/energy/billing/summary.
      if (args?.deviceId) {
        const meters = await hc3.request('/api/energy/devices') as any[];
        const found = meters.find((m: any) => m.id === args.deviceId);
        if (found) return found;
        let deviceExists = false;
        try {
          await hc3.request(`/api/devices/${args.deviceId}`);
          deviceExists = true;
        } catch {}
        throw new Error(
          deviceExists
            ? `Device ${args.deviceId} exists but is not registered as an energy meter (no entry under /api/energy/devices). Per-device energy history is not exposed via REST on current firmware.`
            : `Device ${args.deviceId} not found on this HC3.`,
        );
      }
      const [summary, meterDevices] = await Promise.all([
        hc3.request('/api/energy/billing/summary'),
        hc3.request('/api/energy/devices'),
      ]);
      return { summary, meterDevices };
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
      object_ids?: number[];
      object_type?: string;
      from?: number;
      to?: number;
      since_timestamp?: number;
    }): Promise<any> {
      const cappedLimit = Math.min(args?.limit ?? 30, 1000);

      // Lower bound: `from` is the canonical name; `since_timestamp` is a
      // backward-compatible alias. `from` wins if both are given.
      const lowerBound = args?.from ?? args?.since_timestamp;
      const upperBound = args?.to;

      // Merge the scalar `object_id` and the `object_ids` array into one set.
      const idSet = new Set<number>();
      if (typeof args?.object_id === 'number') idSet.add(args.object_id);
      if (Array.isArray(args?.object_ids)) {
        for (const id of args.object_ids) {
          if (typeof id === 'number') idSet.add(id);
        }
      }

      // What HC3's /api/events/history actually honours server-side (verified
      // against the live gateway):
      //   - `from` / `to` (epoch seconds) — yes, reliably; this is what lets a
      //     retrospective window reach arbitrarily far back.
      //   - `objectId` — only when `objectType` is ALSO supplied; on its own it
      //     is silently ignored and you get unfiltered events. There is no
      //     server-side filter for a *set* of ids.
      // So the object-id filter is enforced client-side (the source of truth);
      // objectId/objectType are only handed over as an optional server-side
      // narrowing when the caller gave an unambiguous single id + its type.
      const params = new URLSearchParams();
      // When scoping to a set of objects, pull a generous page so the
      // client-side id filter has enough in-window events to match against;
      // otherwise just ask for the number requested.
      params.set('numberOfRecords', String(idSet.size > 0 ? 1000 : cappedLimit));
      if (args?.event_type) params.set('eventType', args.event_type);
      if (lowerBound !== undefined) params.set('from', String(lowerBound));
      if (upperBound !== undefined) params.set('to', String(upperBound));
      if (args?.object_type) params.set('objectType', args.object_type);
      // Single id + type → let HC3 narrow (and page back through history) too.
      if (idSet.size === 1) params.set('objectId', String([...idSet][0]));

      const res = await hc3.request(`/api/events/history?${params.toString()}`);
      // /api/events/history returns a bare array on current firmware; tolerate
      // an { events: [...] } envelope too in case a build wraps it.
      let events: any[] = Array.isArray(res) ? res
        : Array.isArray(res?.events) ? res.events
          : [];

      // Client-side filters — authoritative. Time window backstops the
      // server-side from/to; the id filter matches each event's objects[].id
      // (the shape HC3 returns: [{ id, type }, ...]) and is the only reliable
      // way to scope to a set of devices/scenes.
      events = events.filter(e => {
        const ts = e?.timestamp ?? 0;
        if (lowerBound !== undefined && ts < lowerBound) return false;
        if (upperBound !== undefined && ts > upperBound) return false;
        if (idSet.size > 0) {
          const objs = Array.isArray(e?.objects) ? e.objects : [];
          if (!objs.some((o: any) => idSet.has(o?.id))) return false;
        }
        return true;
      });

      events.sort((a, b) => (b?.timestamp ?? 0) - (a?.timestamp ?? 0));
      return events.slice(0, cappedLimit);
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
