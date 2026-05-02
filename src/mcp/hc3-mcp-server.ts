#!/usr/bin/env node

/**
 * Fibaro HC3 MCP Server
 * A comprehensive MCP server implementation for Fibaro Home Center 3 REST API integration
 * Based on the official Fibaro HC3 API documentation
 */

import { configurationGuide } from './docs/configuration';
import { programmingGuide } from './docs/quickapp-programming';
import { scenesGuide } from './docs/lua-scenes';
import { examples } from './docs/programming-examples';
import { HC3Client } from './hc3-client';
import { MCPRequest, MCPResponse, MCPTool } from './types';
import { setupStdio } from './transport/stdio';
import { setupHttp } from './transport/http';
import { mergeHandlers } from './tools/registry';
import { deepEqual, deepMerge, verifyWrite } from './util';
import { alarm } from './tools/alarm';
import { sprinklers } from './tools/sprinklers';
import { backups } from './tools/backups';
import { debug } from './tools/debug';
import { ios } from './tools/ios';
import { climate } from './tools/climate';
import { customEvents } from './tools/customEvents';
import { notifications } from './tools/notifications';
import { globals } from './tools/globals';
import { users } from './tools/users';
import { rooms } from './tools/rooms';
import { scenes } from './tools/scenes';
import { profiles } from './tools/profiles';
import { devices } from './tools/devices';
import { quickapps, quickappsCoreSchemas, quickappsExtSchemas } from './tools/quickapps';

const toolModules = [alarm, sprinklers, backups, debug, ios, climate, customEvents, notifications, globals, users, rooms, scenes, profiles, devices, quickapps];
const toolHandlers = mergeHandlers(toolModules);

class HC3MCPServer {
  private hc3: HC3Client;

  constructor() {
    this.hc3 = HC3Client.fromEnv();

    const dispatch = (line: string) => this.handleMessage(line);
    const transport = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();
    if (transport === 'http') {
      setupHttp({ dispatch, hc3: this.hc3 });
    } else {
      setupStdio(dispatch);
    }
  }

  /**
   * Transport-agnostic dispatcher. Parses a raw JSON-RPC line and returns the
   * response envelope (or null for notifications). The stdio transport writes
   * the returned response to stdout; the HTTP transport writes it to the HTTP
   * response body.
   */
  public async handleMessage(message: string): Promise<MCPResponse | null> {
    let request: MCPRequest;
    try {
      request = JSON.parse(message);
    } catch (error) {
      return this.errorResponse(undefined, -32700, 'Parse error');
    }

    // Notifications (no id, or method starts with "notifications/") must not receive a response.
    if (request.id === undefined || request.method?.startsWith('notifications/')) {
      return null;
    }

    try {
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request);
        case 'tools/list':
          return this.handleListTools(request);
        case 'tools/call':
          return await this.handleCallTool(request);
        case 'ping':
          return { jsonrpc: '2.0', id: request.id, result: {} };
        case 'resources/list':
          return { jsonrpc: '2.0', id: request.id, result: { resources: [] } };
        case 'prompts/list':
          return { jsonrpc: '2.0', id: request.id, result: { prompts: [] } };
        default:
          return this.errorResponse(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      return this.errorResponse(request.id, -32603, 'Internal error');
    }
  }

  private handleInitialize(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'hc3-mcp-server',
          version: '3.3.1',
        },
      },
    };
  }

  private handleListTools(request: MCPRequest): MCPResponse {
    const tools: MCPTool[] = [
      ...devices.schemas,

      ...rooms.schemas,

      ...scenes.schemas,

      // System Information
      {
        name: 'get_system_info',
        description: 'Get Fibaro HC3 system information including version, serial number, and status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_network_status',
        description: 'Get network configuration and status information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // Energy Management
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

      {
        name: 'update_user_rights',
        description: 'Update a user\'s access rights (devices / scenes / climateZones / profiles / alarmPartitions) via PUT /api/users/{id}. Follows the standard read-modify-write + post-write-verify pattern: reads the full user record, deep-merges the submitted rights.* subkeys onto the current, and full-array-replaces the leaf arrays (devices, rooms, sections, scenes, zones, etc.) — same HC3 PUT semantics as other array-valued properties. Verifies every submitted array member is present after the write. SAFETY: rejects writes to rights.advanced.* unless allow_advanced_rights=true (17 sensitive subkeys including zWave, backup, access, update — unauthorised access here is a privilege-escalation footgun). Rejects any rights.*.all=true (mass-grant "oops I gave everyone access") unless allow_grant_all=true. Rejects writes targeting superuser-type users (their rights are already all-true by design; any state change there breaks admin access).',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'number',
              description: 'HC3 user id (from get_users). Must be a non-superuser.'
            },
            rights: {
              type: 'object',
              description: 'Partial rights object. Only submitted subkeys are modified; unsubmitted subkeys (scenes, climateZones, etc.) are preserved untouched. Array-valued leaves (rights.devices.devices, rights.devices.rooms, rights.scenes.scenes, etc.) fully replace the current array.'
            },
            allow_advanced_rights: {
              type: 'boolean',
              description: 'Required to write rights.advanced.* (admin / zwave / backup / update / access / alarm / climate etc.). Defaults false.'
            },
            allow_grant_all: {
              type: 'boolean',
              description: 'Required to set rights.<category>.all = true (mass grant). Defaults false.'
            }
          },
          required: ['userId', 'rights']
        }
      },

      ...globals.schemas,

      // User Management
      {
        name: 'get_users',
        description: 'Get all users configured in the HC3 system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      {
        name: 'snapshot',
        description: 'Single-call dump of every mutable HC3 configuration surface for backups, drift detection, and baseline regimes. Read-only. Parallel fetches all selected surfaces with per-surface atomicity (Promise.allSettled — one failing surface doesn\'t abort the others; failures land in surfaceErrors). Default include set: devices, rooms, scenes (with content), quickapps (with files), globals, custom-events, alarm, climate, system, users, hc3-docs. Opt-in only: zwave-parameters (per-device iteration over ~900 devices — adds 90+ seconds to the run). Returns { capturedAt, elapsedMs, surfaces: {...}, surfaceErrors: {...} }. Use for nightly backup scripts and post-incident recovery baselines.',
        inputSchema: {
          type: 'object',
          properties: {
            include: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['devices','rooms','scenes','quickapps','globals','custom-events','alarm','climate','system','users','hc3-docs','zwave-parameters']
              },
              description: 'Optional surfaces to include. Defaults to all except zwave-parameters.'
            },
            exclude: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional surfaces to exclude from the default set. Ignored if include is supplied.'
            }
          }
        }
      },

      // Diagnostic Information
      {
        name: 'list_icons',
        description: 'List all icons HC3 knows about, grouped by `device` / `room` / `scene`. Each entry has the icon name, fileExtension (typically "png" or "svg"), and an internal id. Built-in icons live under /assets/icon/fibaro/{rooms,scena,...}/; user-uploaded icons live under /assets/userIcons/...',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_icon',
        description: 'Fetch an icon\'s binary content from HC3, base64-encoded. Built-in icons resolve to /assets/icon/fibaro/{category}/{name}.{ext}; user-uploaded icons resolve to /assets/userIcons/{category}/{name}.{ext} when userIcon=true. Returns {name, mime, base64, sizeBytes}. The MCP itself does not manipulate images — decode, edit (e.g. with ImageMagick or sips for PNGs, text edits for SVGs), then upload via upload_icon under a new name. Built-in icons cannot be replaced in place; uploads always create user icons.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Icon category. Maps to URL segment: "room"→rooms, "scene"→scena, "device"→{deviceType}/{iconSetName}.' },
            name: { type: 'string', description: 'Icon name (e.g. "room_bedroom"). For device icons see list_icons → device[].iconSetName.' },
            extension: { type: 'string', description: 'File extension. Defaults to "png" for room/scene, must be supplied accurately for device icons (often "svg").' },
            userIcon: { type: 'boolean', description: 'If true, fetch from /assets/userIcons instead of /assets/icon/fibaro. Default false.' }
          },
          required: ['category', 'name']
        }
      },
      {
        name: 'upload_icon',
        description: 'Upload a new user icon via POST /api/icons (multipart/form-data with type, icon, fileExtension). HC3 ignores any caller-supplied filename and auto-assigns "User<N>". Returns the assigned `newName` and `newId` so you can attach via modify_room/modify_scene/etc. (e.g. modify_room({roomId, fields:{icon: "User1010"}})). HC3 5.x has two undocumented PNG constraints that silent-500 if violated: dimensions must be exactly **128×128**, AND the colorspace must be **palette (8-bit colormap, PNG color type 3)** — not RGB or RGBA. Use `magick input.png -resize 128x128 -dither None -colors 256 -define png:color-type=3 output.png` (ImageMagick) or `pngquant --quality=80 input.png` to produce a compatible palette PNG. Returns `{newName, newId, category, extension, hint}`.',
        inputSchema: {
          type: 'object',
          properties: {
            base64: { type: 'string', description: 'Base64-encoded image bytes (no data URL prefix). For PNG: must be 128×128 in palette mode (8-bit colormap, color type 3). For SVG: as-is.' },
            mime: { type: 'string', description: '"image/png" or "image/svg+xml".' },
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Category — records under that bucket in list_icons.' }
          },
          required: ['base64', 'mime', 'category']
        }
      },
      {
        name: 'delete_icon',
        description: 'Delete a user-uploaded icon via DELETE /api/icons. Uses query params (type, id, name, fileExtension) — NOT a JSON body. type must be the icon\'s category ("room", "scene", or "device") — passing "custom" returns 400 WRONG_TYPE. The tool resolves `id` automatically from list_icons unless you pass it explicitly. Built-in icons cannot be deleted; only user-uploaded User<N> icons. Post-delete verifies by re-listing.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Icon name (typically User<N>).' },
            fileExtension: { type: 'string', description: 'File extension matching the stored icon ("png" or "svg").' },
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Icon category. Used both for the existence pre-check and as the type query param.' },
            id: { type: 'number', description: 'Optional. If omitted, looked up via list_icons.' }
          },
          required: ['name', 'fileExtension', 'category']
        }
      },
      {
        name: 'get_diagnostics',
        description: 'Get system diagnostic information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_zwave_mesh_health',
        description: 'Summarise Z-wave mesh health: counts of dead/unconfigured devices, dead devices listed with node IDs and reasons, and breakdowns by room and manufacturer to help identify mesh dead zones. Uses /api/devices?interface=zwave (documented) rather than undocumented /api/diagnostics/* subpaths.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
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
      {
        name: 'get_device_parameters',
        description: 'Read a Z-Wave device\'s configuration parameters with human-readable labels, descriptions, defaults, and format. For each parameter HC3 knows about the device, returns: parameterNumber, current value, size in bytes, source provenance, label, description, default value, and format. PROVENANCE: the `source` field is verbatim from HC3. `"template"` does NOT mean "catalogue default returned as placeholder" — empirically, parameters with non-default values still carry `source: "template"`. It means the value is from HC3\'s template-backed storage layer: what HC3 recorded the device as being configured to, usually via the HC3 UI\'s native Z-Wave configuration path (which transmits). In normal operation these values match the physical device. What HC3 5.x cannot do over REST is re-verify the stored value against the physical device on demand (the mesh read-back path — `getParameter`, `reconfigure`, `pollConfigurationParameter` — is not-implemented or silently no-ops). So treat returned values as "HC3\'s best knowledge, almost certainly accurate", not "guaranteed live readback". Drift from physical reality only occurs if the device was reset physically, a different controller reached it, or someone used the broken PUT `/api/devices/{id}` `{properties: {parameters: [...]}}` path (see S14 — `modify_device` rejects it for this reason). Sources undocumented endpoints `/api/zwave/configuration_parameters/{addr}` and `/api/zwave/parameters_templates/{addr}` (read-only); may break across HC3 firmware updates.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'HC3 device id of a Z-Wave device. Must have a nodeId in its properties.'
            }
          },
          required: ['deviceId']
        },
      },
      {
        name: 'get_zwave_reconfiguration_tasks',
        description: 'Active Z-Wave reconfiguration tasks: what HC3 is currently reconfiguring over the mesh. Each task surfaces the device being reconfigured, its nodeId, the task status (Completed, Failed, InProgress, Queued, Downloading, Reconfiguring), whether it is a soft or full reconfiguration, and the count/names of affected child devices. Sources the undocumented endpoint /api/zwaveReconfigurationTasks (read-only); may break across HC3 firmware updates. Use when a reconfigure has been initiated and you want to check progress without opening the HC3 UI. Returns empty list if no task is active.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_zwave_node_diagnostics',
        description: 'Per-node Z-Wave transmission counters: incoming/outgoing frame totals, outgoing failures, incoming CRC/S0/S2/TransportService/MultiChannel failures, and nonce exchange counts. Enriches each node with device name, room, and a computed outgoingFailedPercent so problem nodes surface immediately. Counters are cumulative since the controller last reset them. Sources the undocumented endpoint /api/zwave/nodes/diagnostics/transmissions (read-only); may break across HC3 firmware updates. Use for identifying which Z-Wave nodes are experiencing retries, CRC errors, or security-layer negotiation problems.',
        inputSchema: {
          type: 'object',
          properties: {
            min_outgoing_failed_percent: {
              type: 'number',
              description: 'If set, only return nodes whose outgoingFailedPercent is >= this threshold (0-100). Useful to filter to problem nodes only.'
            },
            sort_by: {
              type: 'string',
              enum: ['outgoingFailedPercent', 'outgoingFailed', 'incomingTotal', 'outgoingTotal', 'nodeId'],
              description: 'Field to sort nodes by, descending (except nodeId which is ascending). Defaults to outgoingFailedPercent.'
            }
          },
        },
      },

      // Weather Information
      {
        name: 'get_weather',
        description: 'Get current weather information and forecast',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // Home/Away Status
      {
        name: 'get_home_status',
        description: 'Get current home/away status and location information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
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

      ...profiles.schemas,

      ...climate.schemas,

      ...alarm.schemas,

      ...sprinklers.schemas,

      ...customEvents.schemas,

      // Location Management
      {
        name: 'get_location_info',
        description: 'Get location and geofencing information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
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

      ...notifications.schemas,

      ...backups.schemas,

      ...debug.schemas,

      ...ios.schemas,

      ...quickappsCoreSchemas,
      // System Context & Intelligence
      {
        name: 'get_system_context',
        description: 'Get comprehensive system context including device capabilities, room layouts, scene purposes, and system intelligence data',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_device_relationships',
        description: 'Get relationships between devices, including grouped devices, dependencies, and automation connections',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'Optional: Get relationships for specific device',
            },
          },
        },
      },
      {
        name: 'get_automation_suggestions',
        description: 'Get intelligent automation suggestions based on device usage patterns, time of day, and system state',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'explain_device_capabilities',
        description: 'Get human-readable explanations of what devices can do and how to control them effectively',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'Device ID to explain',
            },
          },
          required: ['deviceId'],
        },
      },

      // HC3 Documentation & Programming Context
      {
        name: 'get_hc3_configuration_guide',
        description: 'Get comprehensive HC3 configuration documentation including network settings, users, rooms, Z-Wave setup, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Specific configuration topic (optional): network, users, rooms, zwave, time, location, voip',
              enum: ['network', 'users', 'rooms', 'zwave', 'time', 'location', 'voip', 'all']
            }
          }
        }
      },
      {
        name: 'get_hc3_quickapp_programming_guide',
        description: 'Get HC3 Quick Apps programming documentation including Lua syntax, methods, HTTP/TCP/UDP clients, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Specific programming topic (optional): basic, methods, http, tcp, udp, websocket, mqtt, child_devices',
              enum: ['basic', 'methods', 'http', 'tcp', 'udp', 'websocket', 'mqtt', 'child_devices', 'all']
            }
          }
        }
      },
      {
        name: 'get_hc3_lua_scenes_guide',
        description: 'Get HC3 Lua Scenes programming documentation including conditions, triggers, actions, and examples',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Specific scenes topic (optional): conditions, triggers, actions, examples, api',
              enum: ['conditions', 'triggers', 'actions', 'examples', 'api', 'all']
            }
          }
        }
      },
      {
        name: 'get_hc3_programming_examples',
        description: 'Get practical HC3 programming examples and code snippets for common automation scenarios',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Example category (optional): lighting, security, climate, scenes, devices, mqtt, tcp',
              enum: ['lighting', 'security', 'climate', 'scenes', 'devices', 'mqtt', 'tcp', 'all']
            }
          }
        }
      },

      ...quickappsExtSchemas,

      // Plugin management tools
      {
        name: "get_plugins",
        description: "Get all available plugins including installed and available plugins.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "get_installed_plugins",
        description: "Get list of installed plugins on the system.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "get_plugin_types",
        description: "Get information about all plugin types available in the system with categories.",
        inputSchema: {
          type: "object",
          properties: {
            language: {
              type: "string",
              description: "Language code for localized responses (e.g., 'en', 'pl')",
              default: "en"
            }
          },
          required: []
        }
      },
      {
        name: "get_plugin_view",
        description: "Get plugin view/configuration interface for a specific plugin or device.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "Device ID to get view for"
            },
            pluginName: {
              type: "string",
              description: "Plugin type name (alternative to deviceId)"
            },
            viewType: {
              type: "string",
              description: "Type of view: 'config' or 'view'",
              enum: ["config", "view"],
              default: "view"
            },
            format: {
              type: "string",
              description: "Response format: 'json' or 'xml'",
              enum: ["json", "xml"],
              default: "json"
            },
            language: {
              type: "string",
              description: "Language code for localized responses",
              default: "en"
            }
          }
        }
      },
      {
        name: "update_plugin_view",
        description: "Update plugin view component properties.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "Device ID"
            },
            componentName: {
              type: "string",
              description: "Name of the UI component to update"
            },
            propertyName: {
              type: "string",
              description: "Property name to update (e.g., 'text', 'value', 'visible')"
            },
            newValue: {
              description: "New value for the property (can be string, number, boolean, object, or array)"
            }
          },
          required: ["deviceId", "componentName", "propertyName", "newValue"]
        }
      },
      {
        name: "call_ui_event",
        description: "Trigger UI events on plugin interface elements (buttons, sliders, switches, etc.).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "Device ID"
            },
            elementName: {
              type: "string",
              description: "Name of the UI element"
            },
            eventType: {
              type: "string",
              description: "Type of event to trigger",
              enum: ["onToggled", "onReleased", "onChanged", "onLongPressDown", "onLongPressReleased", "onTabChanged", "onToggleOn", "onToggleOff"]
            },
            value: {
              type: "string",
              description: "Event value (optional)"
            }
          },
          required: ["deviceId", "elementName", "eventType"]
        }
      },
      {
        name: "create_child_device",
        description: "Create a child device for a plugin (e.g., for multi-channel devices).",
        inputSchema: {
          type: "object",
          properties: {
            parentId: {
              type: "number",
              description: "Parent device ID"
            },
            type: {
              type: "string",
              description: "Device type for the child device"
            },
            name: {
              type: "string",
              description: "Name for the child device"
            },
            initialProperties: {
              type: "object",
              description: "Initial properties for the child device"
            },
            initialInterfaces: {
              type: "array",
              description: "Initial interfaces for the child device",
              items: {
                type: "string"
              }
            }
          },
          required: ["parentId", "type", "name"]
        }
      },
      {
        name: "manage_plugin_interfaces",
        description: "Add or remove interfaces from a device.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "Action to perform: 'add' or 'delete'",
              enum: ["add", "delete"]
            },
            deviceId: {
              type: "number",
              description: "Device ID"
            },
            interfaces: {
              type: "array",
              description: "List of interfaces to add or remove",
              items: {
                type: "string"
              }
            }
          },
          required: ["action", "deviceId", "interfaces"]
        }
      },
      {
        name: "restart_plugin",
        description: "Restart a plugin/device.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "Device ID to restart"
            }
          },
          required: ["deviceId"]
        }
      },
      {
        name: "update_device_property",
        description: "Update a device property value via POST /api/plugins/updateProperty. This endpoint is undocumented in the HC3 Swagger and its behaviour is not guaranteed stable across firmware versions — prefer `modify_device` (PUT /api/devices/{id}) for property writes, which uses a documented endpoint, splits top-level vs nested properties cleanly, rejects quickAppVariables, and verifies writes by refetching. Use this tool only when you specifically need the plugin-side write path (e.g. the property you are writing is not exposed on the device record).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "Device ID"
            },
            propertyName: {
              type: "string",
              description: "Property name to update"
            },
            value: {
              description: "New value for the property"
            }
          },
          required: ["deviceId", "propertyName", "value"]
        }
      },
      {
        name: "publish_plugin_event",
        description: "Publish various types of events through the plugin system.",
        inputSchema: {
          type: "object",
          properties: {
            eventType: {
              type: "string",
              description: "Type of event to publish",
              enum: ["centralSceneEvent", "accessControlEvent", "sceneActivationEvent", "deviceFirmwareUpdateEvent", "GeofenceEvent", "ZwaveNodeRemovedEvent", "ZwaveNetworkResetEvent", "VideoGateIncomingCallEvent", "ZwaveDeviceParametersChangedEvent"]
            },
            source: {
              type: "number",
              description: "Source device ID (required for most event types)"
            },
            data: {
              type: "object",
              description: "Event-specific data object"
            }
          },
          required: ["eventType"]
        }
      },
      {
        name: "get_ip_cameras",
        description: "Get list of available IP camera types for plugin installation.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "install_plugin",
        description: "Install a plugin by type (mainly for HC2 compatibility).",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Plugin type to install"
            }
          },
          required: ["type"]
        }
      },
      {
        name: "delete_plugin",
        description: "BULK uninstall of every device of a given plugin type via DELETE /api/plugins/installed?type={type}. Affects all devices of that type, not just one. For per-device deletion (including individual QuickApps), use delete_device instead. When more than one device of the type exists, this tool refuses unless allow_bulk=true — intended to prevent accidental mass-delete when the caller thinks they're removing a single device.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Plugin type (e.g. 'com.fibaro.yrWeather'). All devices of this type are deleted."
            },
            allow_bulk: {
              type: "boolean",
              description: "Required when >1 device of the type exists. Defaults false."
            }
          },
          required: ["type"]
        }
      },
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
      },
      {
        name: "delete_global_variable",
        description: "Delete a global variable by name via DELETE /api/globalVariables/{name}. Reads the variable first to capture the last value (returned in the response as a recovery trail) and to check readOnly. Refuses readOnly globals unless allow_system=true. Post-delete verifies by refetch (expects HTTP 404).",
        inputSchema: {
          type: "object",
          properties: {
            varName: {
              type: "string",
              description: "Name of the global variable to delete."
            },
            allow_system: {
              type: "boolean",
              description: "Required to delete readOnly (system) globals. Defaults false."
            }
          },
          required: ["varName"]
        }
      },
    ];

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools,
      },
    };
  }

  private async handleCallTool(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params;

    try {
      let result: any;

      if (name in toolHandlers) {
        result = await toolHandlers[name](this.hc3, args);
      } else { switch (name) {
        // System Information
        case 'get_system_info':
          result = await this.getSystemInfo();
          break;
        case 'get_network_status':
          result = await this.getNetworkStatus();
          break;

        // Energy Management
        case 'get_energy_data':
          result = await this.getEnergyData(args);
          break;

        // Diagnostic Information
        case 'snapshot':
          result = await this.snapshot(args);
          break;
        case 'list_icons':
          result = await this.listIcons();
          break;
        case 'get_icon':
          result = await this.getIcon(args);
          break;
        case 'upload_icon':
          result = await this.uploadIcon(args);
          break;
        case 'delete_icon':
          result = await this.deleteIcon(args);
          break;
        case 'get_diagnostics':
          result = await this.getDiagnostics();
          break;
        case 'get_zwave_mesh_health':
          result = await this.getZwaveMeshHealth();
          break;
        case 'get_zwave_node_diagnostics':
          result = await this.getZwaveNodeDiagnostics(
            args?.min_outgoing_failed_percent as number | undefined,
            args?.sort_by as string | undefined
          );
          break;
        case 'get_zwave_reconfiguration_tasks':
          result = await this.getZwaveReconfigurationTasks();
          break;
        case 'get_device_parameters':
          result = await this.getDeviceParameters(args?.deviceId as number);
          break;
        case 'get_refresh_states':
          result = await this.getRefreshStates(args);
          break;
        case 'get_event_history':
          result = await this.getEventHistory(
            args?.limit as number | undefined,
            args?.event_type as string | undefined,
            args?.object_id as number | undefined,
            args?.object_type as string | undefined,
            args?.since_timestamp as number | undefined
          );
          break;

        // Weather Information
        case 'get_weather':
          result = await this.getWeather();
          break;

        // Home/Away Status
        case 'get_home_status':
          result = await this.getHomeStatus();
          break;
        case 'set_home_status':
          result = await this.setHomeStatus(args);
          break;

        // Location Management
        case 'get_location_info':
          result = await this.getLocationInfo();
          break;
        case 'update_location_settings':
          result = await this.updateLocationSettings(args);
          break;

        // System Context & Intelligence
        case 'get_system_context':
          result = await this.getSystemContext(args);
          break;
        case 'get_device_relationships':
          result = await this.getDeviceRelationships(args);
          break;
        case 'get_automation_suggestions':
          result = await this.getAutomationSuggestions(args);
          break;
        case 'explain_device_capabilities':
          result = await this.explainDeviceCapabilities(args);
          break;

        // HC3 Documentation & Programming Context
        case 'get_hc3_configuration_guide':
          result = await this.getHC3ConfigurationGuide(args);
          break;
        case 'get_hc3_quickapp_programming_guide':
          result = await this.getHC3QuickAppProgrammingGuide(args);
          break;
        case 'get_hc3_lua_scenes_guide':
          result = await this.getHC3LuaScenesGuide(args);
          break;
        case 'get_hc3_programming_examples':
          result = await this.getHC3ProgrammingExamples(args);
          break;

        // Plugin management
        case 'get_plugins':
          result = await this.getPlugins(args);
          break;
        case 'get_installed_plugins':
          result = await this.getInstalledPlugins(args);
          break;
        case 'get_plugin_types':
          result = await this.getPluginTypes(args);
          break;
        case 'get_plugin_view':
          result = await this.getPluginView(args);
          break;
        case 'update_plugin_view':
          result = await this.updatePluginView(args);
          break;
        case 'call_ui_event':
          result = await this.callUIEvent(args);
          break;
        case 'create_child_device':
          result = await this.createChildDevice(args);
          break;
        case 'manage_plugin_interfaces':
          result = await this.managePluginInterfaces(args);
          break;
        case 'restart_plugin':
          result = await this.restartPlugin(args);
          break;
        case 'update_device_property':
          result = await this.updateDeviceProperty(args);
          break;
        case 'publish_plugin_event':
          result = await this.publishPluginEvent(args);
          break;
        case 'get_ip_cameras':
          result = await this.getIPCameras(args);
          break;
        case 'install_plugin':
          result = await this.installPlugin(args);
          break;
        case 'delete_plugin':
          result = await this.deletePlugin(args);
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      } }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.errorResponse(request.id, -32000, errorMessage);
    }
  }

  private deepEqual(a: any, b: any): boolean {
    return deepEqual(a, b);
  }

  private deepMerge(base: any, overlay: any): any {
    return deepMerge(base, overlay);
  }

  private async tolerantFetch<T>(
    label: string,
    promise: Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    try {
      return { ok: true, value: await promise };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  }

  private verifyWrite(
    topLevel: Record<string, any> | undefined,
    properties: Record<string, any> | undefined,
    after: any,
    entityLabel: string
  ): void {
    verifyWrite(topLevel, properties, after, entityLabel);
  }

  // System Information Methods
  private async getSystemInfo(): Promise<any> {
    return await this.hc3.request('/api/settings/info');
  }

  private async getNetworkStatus(): Promise<any> {
    return await this.hc3.request('/api/settings/network');
  }

  // Energy Management Methods
  private async getEnergyData(args: { deviceId?: number }): Promise<any> {
    if (args?.deviceId) {
      return await this.hc3.request(`/api/energy/${args.deviceId}`);
    } else {
      return await this.hc3.request('/api/energy');
    }
  }

  // Diagnostic Methods
  private async snapshot(args: { include?: string[]; exclude?: string[] }): Promise<any> {
    const DEFAULT_INCLUDE = [
      'devices','rooms','scenes','quickapps','globals','custom-events',
      'alarm','climate','system','users','hc3-docs'
    ];
    const ALL = [...DEFAULT_INCLUDE, 'zwave-parameters'];

    let selected: string[];
    if (args?.include && args.include.length > 0) {
      selected = args.include.filter(s => ALL.includes(s));
    } else {
      const excludeSet = new Set(args?.exclude ?? []);
      selected = DEFAULT_INCLUDE.filter(s => !excludeSet.has(s));
    }

    const started = Date.now();
    const surfaces: Record<string, any> = {};
    const surfaceErrors: Record<string, string> = {};

    // Simple surfaces: one endpoint, pass through
    const simple: Record<string, string> = {
      'devices': '/api/devices',
      'rooms': '/api/rooms',
      'scenes': '/api/scenes',
      'globals': '/api/globalVariables',
      'custom-events': '/api/customEvents',
      'alarm': '/api/alarms/v1/partitions',
      'climate': '/api/panels/climate',
      'system': '/api/settings/info',
      'users': '/api/users',
    };

    const jobs: Promise<void>[] = [];

    for (const name of selected) {
      if (name in simple) {
        jobs.push(
          this.hc3.request(simple[name])
            .then((v: any) => { surfaces[name] = v; })
            .catch((e: any) => { surfaceErrors[name] = String(e?.message ?? e); })
        );
        continue;
      }

      if (name === 'hc3-docs') {
        jobs.push((async () => {
          const docs: Record<string, any> = {};
          await Promise.allSettled([
            this.hc3.request('/assets/docs/hc/plugins.json')
              .then((v: any) => { docs['plugins.json'] = v; })
              .catch((e: any) => { surfaceErrors['hc3-docs.plugins.json'] = String(e?.message ?? e); }),
            this.hc3.request('/assets/docs/hc/quickapp.json')
              .then((v: any) => { docs['quickapp.json'] = v; })
              .catch((e: any) => { surfaceErrors['hc3-docs.quickapp.json'] = String(e?.message ?? e); })
          ]);
          surfaces['hc3-docs'] = docs;
        })());
        continue;
      }

      if (name === 'quickapps') {
        jobs.push((async () => {
          try {
            const qas: any[] = await this.hc3.request('/api/devices?interface=quickApp');
            const result: any[] = [];
            await Promise.allSettled(qas.map(async (qa: any) => {
              try {
                const fileList: any[] = await this.hc3.request(`/api/quickApp/${qa.id}/files`);
                const files = await Promise.allSettled(
                  (fileList ?? []).map(async f => {
                    try {
                      const content: any = await this.hc3.request(
                        `/api/quickApp/${qa.id}/files/${encodeURIComponent(f.name)}`
                      );
                      return { name: f.name, isMain: !!f.isMain, isOpen: !!f.isOpen, type: f.type ?? null, content: content?.content ?? '' };
                    } catch (e: any) {
                      surfaceErrors[`quickapps.${qa.id}.${f.name}`] = String(e?.message ?? e);
                      return null;
                    }
                  })
                );
                const filesOk = files
                  .filter(r => r.status === 'fulfilled' && r.value)
                  .map(r => (r as PromiseFulfilledResult<any>).value);
                result.push({ id: qa.id, name: qa.name, type: qa.type, roomID: qa.roomID, files: filesOk });
              } catch (e: any) {
                surfaceErrors[`quickapps.${qa.id}`] = String(e?.message ?? e);
              }
            }));
            surfaces['quickapps'] = result;
          } catch (e: any) {
            surfaceErrors['quickapps'] = String(e?.message ?? e);
          }
        })());
        continue;
      }

      if (name === 'zwave-parameters') {
        jobs.push((async () => {
          try {
            const devices: any[] = await this.hc3.request('/api/devices?interface=zwave');
            const parents = devices.filter(d => {
              const nid = d?.properties?.nodeId;
              return typeof nid === 'number' && (d.parentId === 1 || d.parentId === 0);
            });
            const result: any[] = [];
            const concurrency = 8;
            for (let i = 0; i < parents.length; i += concurrency) {
              const batch = parents.slice(i, i + concurrency);
              const settled = await Promise.allSettled(batch.map(async d => {
                const nid = d.properties.nodeId;
                const ep = d.properties.endPointId ?? 0;
                const addr = `${nid}.${ep}`;
                try {
                  const v: any = await this.hc3.request(
                    `/api/zwave/configuration_parameters/${encodeURIComponent(addr)}`
                  );
                  return { deviceId: d.id, nodeId: nid, addr, parameters: v?.items ?? [] };
                } catch (e: any) {
                  surfaceErrors[`zwave-parameters.${d.id}`] = String(e?.message ?? e);
                  return null;
                }
              }));
              for (const r of settled) {
                if (r.status === 'fulfilled' && r.value) result.push(r.value);
              }
            }
            surfaces['zwave-parameters'] = result;
          } catch (e: any) {
            surfaceErrors['zwave-parameters'] = String(e?.message ?? e);
          }
        })());
        continue;
      }
    }

    await Promise.allSettled(jobs);

    return {
      capturedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      surfaces,
      surfaceErrors,
      includeResolved: selected
    };
  }

  // Icon methods
  private async listIcons(): Promise<any> {
    return await this.hc3.request('/api/icons');
  }

  private async getIcon(args: {
    category: 'room' | 'scene' | 'device';
    name: string;
    extension?: string;
    userIcon?: boolean;
  }): Promise<any> {
    if (!args?.category) throw new Error('get_icon requires category.');
    if (!args?.name) throw new Error('get_icon requires name.');
    const ext = args.extension ?? 'png';
    const segment = args.category === 'room' ? 'rooms'
      : args.category === 'scene' ? 'scena'
      : args.category;
    const base = args.userIcon ? '/assets/userIcons' : '/assets/icon/fibaro';
    const path = `${base}/${segment}/${encodeURIComponent(args.name)}.${ext}`;
    const url = `http://${this.hc3.config.host}:${this.hc3.config.port}${path}`;
    const auth = Buffer.from(`${this.hc3.config.username}:${this.hc3.config.password}`).toString('base64');
    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`get_icon: HTTP ${response.status} fetching ${path}`);
    }
    const mime = response.headers.get('content-type') ?? 'application/octet-stream';
    const buf = Buffer.from(await response.arrayBuffer());
    // Detect HC3's silent-fallback for missing icons: when a .png path is
    // requested but the server returns image/svg+xml, HC3 has substituted its
    // 1888-byte "unknown icon" SVG fallback rather than 404'ing.
    if (ext === 'png' && mime.startsWith('image/svg')) {
      throw new Error(
        `get_icon: ${path} not found — HC3 silently returned its SVG "unknown icon" fallback (1.9 KB) instead of 404. Check name/extension via list_icons.`
      );
    }
    return {
      name: args.name,
      extension: ext,
      mime,
      sizeBytes: buf.length,
      base64: buf.toString('base64')
    };
  }

  private async uploadIcon(args: {
    base64: string;
    mime: string;
    category: 'room' | 'scene' | 'device';
  }): Promise<any> {
    if (!args?.base64) throw new Error('upload_icon requires base64.');
    if (!args?.mime) throw new Error('upload_icon requires mime.');
    if (!args?.category) throw new Error('upload_icon requires category.');
    if (!this.hc3.config.host || !this.hc3.config.username || !this.hc3.config.password) {
      throw new Error('Fibaro HC3 not configured.');
    }
    const ext = args.mime === 'image/svg+xml' ? 'svg'
      : args.mime === 'image/png' ? 'png'
      : args.mime === 'image/jpeg' ? 'jpg'
      : 'png';
    const bytes = Buffer.from(args.base64, 'base64');

    // Validate PNG dimensions + palette mode at the tool boundary so callers
    // get a clear error rather than HC3's misleading silent-500 on RGB or
    // wrong-size PNGs.
    if (ext === 'png') {
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('upload_icon: provided bytes are not a valid PNG.');
      }
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      const colorType = bytes.readUInt8(25);
      if (width !== 128 || height !== 128) {
        throw new Error(
          `upload_icon: PNG must be 128x128. Got ${width}x${height}. HC3 silently 500s on other dimensions. Resize with e.g. \`magick input.png -resize 128x128 output.png\`.`
        );
      }
      if (colorType !== 3) {
        throw new Error(
          `upload_icon: PNG must be palette mode (color type 3 / 8-bit colormap). Got color type ${colorType}. HC3 silently 500s on RGB/RGBA. Convert with e.g. \`magick in.png -dither None -colors 256 -define png:color-type=3 out.png\` or \`pngquant in.png\`.`
        );
      }
    }

    const before: any = await this.hc3.request('/api/icons');
    const bucketBefore: any[] = (before?.[args.category] as any[]) || [];
    const userIdsBefore = new Set(bucketBefore.map(i => i.id));

    // Manual multipart so we control the bytes exactly. Node 18's FormData +
    // Blob is fine in principle, but explicit construction matches what curl
    // -F sends and avoids any boundary/header surprises.
    const boundary = '----mcphc3' + Date.now().toString(16);
    const CRLF = '\r\n';
    const partHead = (name: string, filename?: string, type?: string) =>
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"` +
      (filename ? `; filename="${filename}"` : '') + CRLF +
      (type ? `Content-Type: ${type}${CRLF}` : '') + CRLF;
    const body = Buffer.concat([
      Buffer.from(partHead('type') + args.category + CRLF + partHead('icon', `mcp.${ext}`, args.mime)),
      bytes,
      Buffer.from(CRLF + partHead('fileExtension') + ext + CRLF + `--${boundary}--${CRLF}`)
    ]);

    const auth = Buffer.from(`${this.hc3.config.username}:${this.hc3.config.password}`).toString('base64');
    const response = await fetch(`http://${this.hc3.config.host}:${this.hc3.config.port}/api/icons`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (response.status === 500 && ext === 'png') {
        throw new Error(
          `upload_icon: HTTP 500 from HC3. The pre-checks (128x128, palette mode) passed at the tool boundary, so HC3 may be in a bad state — try again, or restart HC3 if persistent. Raw response: ${errText}`
        );
      }
      throw new Error(`upload_icon: HTTP ${response.status} - ${errText}`);
    }

    // HC3 returns {id, iconSetName, fileExtension} on success. Capture from the response;
    // also re-list as a sanity check.
    let created: any;
    try { created = JSON.parse(await response.text()); } catch { created = null; }
    const after: any = await this.hc3.request('/api/icons');
    const bucketAfter: any[] = (after?.[args.category] as any[]) || [];
    const newOnes = bucketAfter.filter(i => !userIdsBefore.has(i.id));
    if (newOnes.length === 0) {
      throw new Error(
        `upload_icon: post-upload verify failed — no new icon appeared in ${args.category} bucket. HC3 silently dropped the upload despite returning 2xx.`
      );
    }
    const fresh = newOnes[0];
    const newName = fresh.iconName || fresh.iconSetName;
    return {
      newName,
      newId: fresh.id,
      category: args.category,
      extension: ext,
      hint: `Attach with modify_room/modify_scene/etc. (e.g. modify_room({roomId, fields:{icon: "${newName}"}})). Re-fetch later via get_icon({category: "${args.category}", name: "${newName}", extension: "${ext}", userIcon: true}).`
    };
  }

  private async deleteIcon(args: {
    name: string;
    fileExtension: string;
    category: 'room' | 'scene' | 'device';
    id?: number;
  }): Promise<any> {
    if (!args?.name) throw new Error('delete_icon requires name.');
    if (!args?.fileExtension) throw new Error('delete_icon requires fileExtension.');
    if (!args?.category) throw new Error('delete_icon requires category.');

    const before: any = await this.hc3.request('/api/icons');
    const bucket: any[] = (before?.[args.category] as any[]) || [];
    const found = bucket.find(i =>
      i.iconName === args.name || i.iconSetName === args.name
    );
    if (!found) {
      throw new Error(
        `delete_icon: '${args.name}' not found in ${args.category} bucket. ` +
        `Use list_icons to inspect.`
      );
    }
    const id = args.id ?? found.id;
    if (typeof id !== 'number') {
      throw new Error(`delete_icon: could not resolve id for '${args.name}'. Pass id explicitly.`);
    }

    // HC3's DELETE /api/icons uses query params (NOT a JSON body) and requires
    // type ∈ {device, room, scene} (NOT "custom" as some docs say) plus id,
    // name, and fileExtension. All four are required.
    const params = new URLSearchParams({
      type: args.category,
      id: String(id),
      name: args.name,
      fileExtension: args.fileExtension,
    });
    await this.hc3.request(`/api/icons?${params.toString()}`, 'DELETE');

    const after: any = await this.hc3.request('/api/icons');
    const stillThere = (after?.[args.category] as any[] ?? []).find(i =>
      i.iconName === args.name || i.iconSetName === args.name
    );
    if (stillThere) {
      throw new Error(
        `delete_icon: post-delete verify failed — '${args.name}' still in the ${args.category} bucket. ` +
        `Built-in icons cannot be deleted via the API; only user-uploaded icons (User<N>) can.`
      );
    }
    return { deleted: args.name, id, category: args.category };
  }

  private async getDiagnostics(): Promise<any> {
    return await this.hc3.request('/api/diagnostics');
  }

  private async getZwaveMeshHealth(): Promise<any> {
    const [devices, rooms] = await Promise.all([
      this.hc3.request('/api/devices?interface=zwave'),
      this.hc3.request('/api/rooms')
    ]);

    const roomNameById: Record<number, string> = {};
    for (const r of rooms) roomNameById[r.id] = r.name;

    const nodes: any[] = (devices as any[]).filter(d => d?.properties?.nodeId !== undefined);
    const dead = nodes.filter(d => d.properties.dead === true);
    const unconfigured = nodes.filter(d => d.properties.configured === false);

    const deadByRoom: Record<string, number> = {};
    const deadByManufacturer: Record<string, number> = {};
    for (const d of dead) {
      const roomName = roomNameById[d.roomID] ?? `room ${d.roomID}`;
      deadByRoom[roomName] = (deadByRoom[roomName] ?? 0) + 1;
      const mfr = d.properties.zwaveCompany || 'Unknown';
      deadByManufacturer[mfr] = (deadByManufacturer[mfr] ?? 0) + 1;
    }

    return {
      total_zwave_devices: nodes.length,
      dead_count: dead.length,
      dead_rate_pct: nodes.length > 0 ? Math.round((dead.length / nodes.length) * 1000) / 10 : 0,
      unconfigured_count: unconfigured.length,
      dead_devices: dead.map(d => ({
        id: d.id,
        name: d.name,
        nodeId: d.properties.nodeId,
        roomID: d.roomID,
        roomName: roomNameById[d.roomID] ?? null,
        deadReason: d.properties.deadReason || null,
        zwaveCompany: d.properties.zwaveCompany || null
      })),
      unconfigured_devices: unconfigured.map(d => ({
        id: d.id,
        name: d.name,
        nodeId: d.properties.nodeId,
        roomID: d.roomID,
        roomName: roomNameById[d.roomID] ?? null
      })),
      dead_by_room: deadByRoom,
      dead_by_manufacturer: deadByManufacturer
    };
  }

  private async getZwaveNodeDiagnostics(minOutgoingFailedPercent?: number, sortBy?: string): Promise<any> {
    const [transmissions, devices, rooms] = await Promise.all([
      this.hc3.request('/api/zwave/nodes/diagnostics/transmissions'),
      this.hc3.request('/api/devices?interface=zwave'),
      this.hc3.request('/api/rooms')
    ]);

    const roomNameById: Record<number, string> = {};
    for (const r of rooms) roomNameById[r.id] = r.name;

    const deviceByNodeId: Record<number, any> = {};
    for (const d of devices as any[]) {
      const nid = d?.properties?.nodeId;
      if (nid !== undefined && deviceByNodeId[nid] === undefined) deviceByNodeId[nid] = d;
    }

    const items: any[] = (transmissions?.items as any[]) || [];
    const enriched = items.map(n => {
      const dev = deviceByNodeId[n.nodeId];
      const incomingFailedTotal =
        (n.incomingFailedUndefined || 0) +
        (n.incomingFailedCrc || 0) +
        (n.incomingFailedS0 || 0) +
        (n.incomingFailedS2 || 0) +
        (n.incomingFailedTransportService || 0) +
        (n.incomingFailedMultiChannel || 0);
      const outgoingFailedPercent = n.outgoingTotal > 0
        ? Math.round((n.outgoingFailed / n.outgoingTotal) * 1000) / 10
        : 0;
      return {
        nodeId: n.nodeId,
        deviceName: dev?.name ?? null,
        deviceId: dev?.id ?? null,
        roomName: dev ? (roomNameById[dev.roomID] ?? null) : null,
        zwaveCompany: dev?.properties?.zwaveCompany ?? null,
        incomingTotal: n.incomingTotal,
        incomingFailedTotal,
        incomingFailedUndefined: n.incomingFailedUndefined,
        incomingFailedCrc: n.incomingFailedCrc,
        incomingFailedS0: n.incomingFailedS0,
        incomingFailedS2: n.incomingFailedS2,
        incomingFailedTransportService: n.incomingFailedTransportService,
        incomingFailedMultiChannel: n.incomingFailedMultiChannel,
        incomingNonceGet: n.incomingNonceGet,
        incomingNonceReport: n.incomingNonceReport,
        outgoingTotal: n.outgoingTotal,
        outgoingFailed: n.outgoingFailed,
        outgoingFailedPercent,
        outgoingNonceGet: n.outgoingNonceGet,
        outgoingNonceReport: n.outgoingNonceReport
      };
    });

    const filtered = typeof minOutgoingFailedPercent === 'number'
      ? enriched.filter(n => n.outgoingFailedPercent >= minOutgoingFailedPercent)
      : enriched;

    const sortKey = sortBy || 'outgoingFailedPercent';
    const sorted = [...filtered].sort((a: any, b: any) => {
      if (sortKey === 'nodeId') return a.nodeId - b.nodeId;
      return (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
    });

    return {
      source: '/api/zwave/nodes/diagnostics/transmissions (undocumented)',
      counters_are: 'cumulative since last controller reset',
      node_count: sorted.length,
      nodes: sorted
    };
  }

  private async getDeviceParameters(deviceId: number): Promise<any> {
    if (typeof deviceId !== 'number') {
      throw new Error('get_device_parameters requires a numeric deviceId.');
    }
    const device: any = await this.hc3.request(`/api/devices/${deviceId}`);
    const nodeId = device?.properties?.nodeId;
    if (nodeId === undefined || nodeId === null) {
      throw new Error(
        `Device ${deviceId} (${device?.name}) has no Z-Wave nodeId; get_device_parameters only supports Z-Wave devices.`
      );
    }
    const endpoint = device?.properties?.endPointId ?? 0;
    const addr = `${nodeId}.${endpoint}`;
    const encodedAddr = encodeURIComponent(addr);

    const [valuesRes, templateRes] = await Promise.all([
      this.hc3.request(`/api/zwave/configuration_parameters/${encodedAddr}`)
        .catch((e: any) => ({ __error: String(e?.message ?? e) })),
      this.hc3.request(`/api/zwave/parameters_templates/${encodedAddr}`)
        .catch((e: any) => ({ __error: String(e?.message ?? e) }))
    ]);

    const values: any[] = Array.isArray((valuesRes as any)?.items) ? (valuesRes as any).items : [];
    const templateParams: any[] = Array.isArray((templateRes as any)?.parameters) ? (templateRes as any).parameters : [];
    const templateByNumber = new Map<number, any>(
      templateParams.map(p => [p.parameterNumber, p])
    );

    const pickEn = (localised: any): string | null => {
      if (typeof localised === 'string') return localised;
      if (localised && typeof localised === 'object') return localised.en ?? null;
      return null;
    };

    const merged = values.map(v => {
      const tpl = templateByNumber.get(v.parameterNumber) ?? {};
      return {
        parameterNumber: v.parameterNumber,
        value: v.configurationValue,
        size: v.size,
        source: v.source?.type ?? null,
        label: pickEn(tpl.label),
        description: pickEn(tpl.description),
        defaultValue: tpl.defaultValue ?? null,
        format: tpl.format ?? null
      };
    });

    const storedOnly = values.every(v => v.source?.type === 'template');

    return {
      deviceId,
      deviceName: device?.name ?? null,
      nodeId,
      endpoint,
      addr,
      productType: (templateRes as any)?.description ?? null,
      parameters: merged,
      provenance_note:
        'Values are from HC3\'s stored-values layer, normally populated when the device was configured ' +
        'via HC3\'s native Z-Wave path (the HC3 UI, which transmits). In normal operation they match ' +
        'the physical device. HC3 5.x cannot re-verify them over REST on demand — the mesh read-back ' +
        'path is not-implemented on this firmware — so treat the values as "almost certainly correct, ' +
        'not programmatically re-provable". Drift from physical reality only occurs if the device was ' +
        'physically reset, a different controller reached it, or someone used the PUT ' +
        '/api/devices/{id} {properties: {parameters:[...]}} path (cache-only — modify_device rejects ' +
        'this for the same reason). `source: "template"` on a parameter means "stored in HC3\'s ' +
        'template-backed storage", NOT "this is the catalogue default". Empirically, parameters with ' +
        'non-default values still carry source "template".',
      all_values_are_hc3_stored: storedOnly
    };
  }

  private async getZwaveReconfigurationTasks(): Promise<any> {
    const [tasks, devices, rooms] = await Promise.all([
      this.hc3.request('/api/zwaveReconfigurationTasks'),
      this.hc3.request('/api/devices?interface=zwave'),
      this.hc3.request('/api/rooms')
    ]);

    const roomNameById: Record<number, string> = {};
    for (const r of rooms) roomNameById[r.id] = r.name;

    const roomIdByDeviceId: Record<number, number> = {};
    for (const d of devices as any[]) {
      if (d?.id !== undefined && d?.roomID !== undefined) roomIdByDeviceId[d.id] = d.roomID;
    }

    const items: any[] = Array.isArray(tasks) ? tasks : [];
    const enriched = items.map((t: any) => {
      const roomId = roomIdByDeviceId[t.deviceId];
      const children: any[] = Array.isArray(t.childDevices) ? t.childDevices : [];
      return {
        id: t.id,
        status: t.status,
        deviceId: t.deviceId,
        deviceName: t.name ?? null,
        roomName: roomId !== undefined ? (roomNameById[roomId] ?? null) : null,
        nodeId: t.nodeId,
        softReconfiguration: t.softReconfiguration,
        battery: t.battery,
        remoteGateway: t.remoteGateway || null,
        childDeviceCount: children.length,
        childDeviceNames: children.map(c => c?.data?.name).filter((n: any) => typeof n === 'string').slice(0, 20)
      };
    });

    return {
      source: '/api/zwaveReconfigurationTasks (undocumented)',
      task_count: enriched.length,
      tasks: enriched
    };
  }

  private async getRefreshStates(args: { last?: number }): Promise<any> {
    const last = typeof args?.last === 'number' ? args.last : 0;
    return await this.hc3.request(`/api/refreshStates?last=${last}&lang=en`);
  }

  private async getEventHistory(
    limit?: number,
    eventType?: string,
    objectId?: number,
    objectType?: string,
    sinceTimestamp?: number
  ): Promise<any> {
    const cappedLimit = Math.min(limit ?? 30, 1000);
    const params = new URLSearchParams();
    params.set('numberOfRecords', String(cappedLimit));
    if (eventType) params.set('eventType', eventType);
    if (objectId !== undefined) params.set('objectId', String(objectId));
    if (objectType) params.set('objectType', objectType);
    const events: any[] = await this.hc3.request(`/api/events/history?${params.toString()}`);
    if (sinceTimestamp !== undefined) {
      return events.filter(e => (e?.timestamp ?? 0) >= sinceTimestamp);
    }
    return events;
  }

  // Weather Methods
  private async getWeather(): Promise<any> {
    return await this.hc3.request('/api/weather');
  }

  // Home Status Methods
  private async getHomeStatus(): Promise<any> {
    return await this.hc3.request('/api/panels/location');
  }

  private async setHomeStatus(args: { status: string }): Promise<any> {
    const validModes = ['Home', 'Away', 'Night', 'Vacation'];
    if (!validModes.includes(args.status)) {
      throw new Error(`set_home_status: invalid status '${args.status}'. Must be one of: ${validModes.join(', ')}.`);
    }
    await this.hc3.request('/api/panels/location', 'PUT', { mode: args.status });
    return `Home status set to '${args.status}' successfully.`;
  }

  // Location Management Methods
  private async getLocationInfo(): Promise<any> {
    return await this.hc3.request('/api/panels/location');
  }

  private async updateLocationSettings(args: {
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

    const current = await this.hc3.request(`/api/panels/location/${locationId}`);
    const merged = this.deepMerge(current, fields);
    await this.hc3.request(`/api/panels/location/${locationId}`, 'PUT', merged);
    const after = await this.hc3.request(`/api/panels/location/${locationId}`);
    this.verifyWrite(fields, undefined, after, `location ${locationId}`);

    return {
      locationId,
      submitted: { fields },
      verified: true
    };
  }


  // System Context & Intelligence Methods
  private async getSystemContext(args: any): Promise<any> {
    try {
      // Primary fetches (devices/rooms/scenes/variables) propagate errors so
      // HC3 unreachability surfaces instead of returning empty arrays.
      // Ancillary (info/weather) tolerated and reported via _fetch_errors.
      const [infoResult, devices, rooms, scenes, variables, weatherResult] = await Promise.all([
        this.tolerantFetch('system_info', this.hc3.request('/api/settings/info')),
        this.hc3.request('/api/devices'),
        this.hc3.request('/api/rooms'),
        this.hc3.request('/api/scenes'),
        this.hc3.request('/api/globalVariables'),
        this.tolerantFetch('weather', this.hc3.request('/api/weather'))
      ]);

      const info = infoResult.ok ? infoResult.value : null;
      const weather = weatherResult.ok ? weatherResult.value : null;
      const fetchErrors: Record<string, string> = {};
      if (!infoResult.ok) fetchErrors.system_info = infoResult.error;
      if (!weatherResult.ok) fetchErrors.weather = weatherResult.error;

      return {
        system_info: info,
        device_count: devices.length,
        room_count: rooms.length,
        scene_count: scenes.length,
        variable_count: variables.length,
        weather_data: weather,
        devices: devices.slice(0, 10), // First 10 devices as sample
        rooms: rooms,
        recent_scenes: scenes.slice(0, 5),
        key_variables: variables.slice(0, 10),
        ...(Object.keys(fetchErrors).length > 0 ? { _fetch_errors: fetchErrors } : {})
      };
    } catch (error) {
      throw new Error(`Failed to get system context: ${error}`);
    }
  }

  private async getDeviceRelationships(args: any): Promise<any> {
    try {
      const deviceId = args.deviceId;
      const [devices, rooms, scenes] = await Promise.all([
        this.hc3.request('/api/devices'),
        this.hc3.request('/api/rooms'),
        this.hc3.request('/api/scenes')
      ]);

      if (deviceId) {
        const device = devices.find((d: any) => d.id === parseInt(deviceId));
        if (!device) {
          throw new Error(`Device ${deviceId} not found`);
        }

        const room = rooms.find((r: any) => r.id === device.roomID);
        const relatedDevices = devices.filter((d: any) => 
          d.roomID === device.roomID && d.id !== device.id
        );
        const relatedScenes = scenes.filter((s: any) => 
          s.devices && s.devices.includes(device.id)
        );

        return {
          device: device,
          room: room,
          related_devices: relatedDevices,
          related_scenes: relatedScenes,
          device_type: device.type,
          capabilities: device.properties || {}
        };
      }

      // Return general relationship overview
      const devicesByRoom = rooms.map((room: any) => ({
        room: room,
        devices: devices.filter((d: any) => d.roomID === room.id)
      }));

      return {
        devices_by_room: devicesByRoom,
        total_devices: devices.length,
        total_rooms: rooms.length,
        device_types: [...new Set(devices.map((d: any) => d.type))]
      };
    } catch (error) {
      throw new Error(`Failed to get device relationships: ${error}`);
    }
  }

  private async getAutomationSuggestions(args: any): Promise<any> {
    try {
      const [devices, scenesResult, variablesResult] = await Promise.all([
        this.hc3.request('/api/devices'),
        this.tolerantFetch('scenes', this.hc3.request('/api/scenes')),
        this.tolerantFetch('variables', this.hc3.request('/api/globalVariables'))
      ]);

      const scenes: any[] = scenesResult.ok ? scenesResult.value : [];
      const variables: any[] = variablesResult.ok ? variablesResult.value : [];
      const fetchErrors: Record<string, string> = {};
      if (!scenesResult.ok) fetchErrors.scenes = scenesResult.error;
      if (!variablesResult.ok) fetchErrors.variables = variablesResult.error;

      const suggestions: Array<{
        type: string;
        description: string;
        devices: Record<string, any>;
      }> = [];

      // Motion sensor + light automation suggestions
      const motionSensors = devices.filter((d: any) => 
        d.type === 'com.fibaro.motionSensor' || d.name.toLowerCase().includes('motion')
      );
      const lights = devices.filter((d: any) => 
        d.type === 'com.fibaro.binarySwitch' || d.type === 'com.fibaro.dimmer'
      );

      if (motionSensors.length > 0 && lights.length > 0) {
        suggestions.push({
          type: 'motion_lighting',
          description: 'Automatically turn on lights when motion is detected',
          devices: { motion_sensors: motionSensors.slice(0, 3), lights: lights.slice(0, 3) }
        });
      }

      // Temperature-based automation
      const thermostats = devices.filter((d: any) => 
        d.type === 'com.fibaro.thermostat' || d.name.toLowerCase().includes('thermostat')
      );
      if (thermostats.length > 0) {
        suggestions.push({
          type: 'temperature_control',
          description: 'Create temperature-based heating/cooling schedules',
          devices: { thermostats: thermostats }
        });
      }

      // Security automation
      const doorSensors = devices.filter((d: any) => 
        d.type === 'com.fibaro.doorSensor' || d.name.toLowerCase().includes('door')
      );
      const cameras = devices.filter((d: any) => 
        d.type === 'com.fibaro.ipCamera' || d.name.toLowerCase().includes('camera')
      );

      if (doorSensors.length > 0 && cameras.length > 0) {
        suggestions.push({
          type: 'security_monitoring',
          description: 'Activate cameras when doors/windows are opened',
          devices: { door_sensors: doorSensors, cameras: cameras }
        });
      }

      return {
        suggestions: suggestions,
        available_scenes: scenes.length,
        available_variables: variables.length,
        automation_potential: suggestions.length > 0 ? 'High' : 'Medium',
        ...(Object.keys(fetchErrors).length > 0 ? { _fetch_errors: fetchErrors } : {})
      };
    } catch (error) {
      throw new Error(`Failed to get automation suggestions: ${error}`);
    }
  }

  private async explainDeviceCapabilities(args: any): Promise<any> {
    try {
      const deviceId = args.deviceId;
      const devices = await this.hc3.request('/api/devices');

      if (!deviceId) {
        throw new Error('deviceId is required');
      }

      const device = devices.find((d: any) => d.id === parseInt(deviceId));
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      // Enhanced capability explanation based on device type
      const capabilities = {
        basic_info: {
          name: device.name,
          type: device.type,
          manufacturer: device.manufacturer || 'Unknown',
          room_id: device.roomID,
          enabled: device.enabled
        },
        properties: device.properties || {},
        actions: device.actions || [],
        interfaces: device.interfaces || [],
        parameters: device.parameters || {}
      };

      // Add type-specific explanations
      let explanation = '';
      const deviceType = device.type?.toLowerCase() || '';

      if (deviceType.includes('switch') || deviceType.includes('dimmer')) {
        explanation = 'This is a lighting control device. You can turn it on/off and possibly adjust brightness.';
      } else if (deviceType.includes('sensor')) {
        explanation = 'This is a sensor device that monitors environmental conditions or detects events.';
      } else if (deviceType.includes('thermostat')) {
        explanation = 'This is a climate control device for managing temperature and heating/cooling.';
      } else if (deviceType.includes('camera')) {
        explanation = 'This is a security camera for monitoring and recording video.';
      } else if (deviceType.includes('door') || deviceType.includes('window')) {
        explanation = 'This is a security sensor that detects when doors or windows are opened/closed.';
      } else {
        explanation = 'This is a home automation device with various capabilities.';
      }

      return {
        device_id: deviceId,
        explanation: explanation,
        capabilities: capabilities,
        current_state: {
          value: device.properties?.value,
          battery_level: device.properties?.batteryLevel,
          last_modified: device.modified
        },
        usage_tips: [
          'Check the properties object for current readings and status',
          'Use actions array to see what commands this device supports',
          'Monitor the modified timestamp to see when it last changed'
        ]
      };
    } catch (error) {
      throw new Error(`Failed to explain device capabilities: ${error}`);
    }
  }

  // HC3 Documentation & Programming Context Methods
  private async getHC3ConfigurationGuide(args: any): Promise<any> {
    const topic = args.topic || 'all';
    
    if (topic === 'all') {
      return {
        title: 'HC3 Configuration Guide',
        sections: configurationGuide
      };
    } else if (configurationGuide[topic as keyof typeof configurationGuide]) {
      return {
        title: 'HC3 Configuration Guide',
        section: configurationGuide[topic as keyof typeof configurationGuide]
      };
    } else {
      return {
        title: 'HC3 Configuration Guide',
        available_topics: Object.keys(configurationGuide).filter(k => k !== 'overview'),
        overview: configurationGuide.overview
      };
    }
  }

  private async getHC3QuickAppProgrammingGuide(args: any): Promise<any> {
    const topic = args.topic || 'all';
    
    if (topic === 'all') {
      return {
        title: 'HC3 Quick Apps Programming Guide',
        sections: programmingGuide
      };
    } else if (programmingGuide[topic as keyof typeof programmingGuide]) {
      return {
        title: 'HC3 Quick Apps Programming Guide',
        section: programmingGuide[topic as keyof typeof programmingGuide]
      };
    } else {
      return {
        title: 'HC3 Quick Apps Programming Guide',
        available_topics: Object.keys(programmingGuide).filter(k => k !== 'overview'),
        overview: programmingGuide.overview
      };
    }
  }

  private async getHC3LuaScenesGuide(args: any): Promise<any> {
    const topic = args.topic || 'all';
    
    if (topic === 'all') {
      return {
        title: 'HC3 Lua Scenes Programming Guide',
        sections: scenesGuide
      };
    } else if (scenesGuide[topic as keyof typeof scenesGuide]) {
      return {
        title: 'HC3 Lua Scenes Programming Guide', 
        section: scenesGuide[topic as keyof typeof scenesGuide]
      };
    } else {
      return {
        title: 'HC3 Lua Scenes Programming Guide',
        available_topics: Object.keys(scenesGuide).filter(k => k !== 'overview'),
        overview: scenesGuide.overview
      };
    }
  }

  private async getHC3ProgrammingExamples(args: any): Promise<any> {
    const category = args.category || 'all';
    
    if (category === 'all') {
      return {
        title: 'HC3 Programming Examples',
        categories: examples
      };
    } else if (examples[category as keyof typeof examples]) {
      return {
        title: 'HC3 Programming Examples',
        category: examples[category as keyof typeof examples]
      };
    } else {
      return {
        title: 'HC3 Programming Examples',
        available_categories: Object.keys(examples).filter(k => k !== 'overview'),
        overview: examples.overview
      };
    }
  }

  // Plugin management methods
  private async getPlugins(args: any): Promise<any> {
    return await this.hc3.request('/api/plugins');
  }

  private async getInstalledPlugins(args: any): Promise<any> {
    return await this.hc3.request('/api/plugins/installed');
  }

  private async getPluginTypes(args: { language?: string }): Promise<any> {
    const { language = 'en' } = args;
    
    // For now, we'll use the basic API request without custom headers
    // The language preference can be handled by the client
    return await this.hc3.request('/api/plugins/types');
  }

  private async getPluginView(args: { 
    deviceId?: number; 
    pluginName?: string; 
    viewType?: string; 
    format?: string; 
    language?: string 
  }): Promise<any> {
    const { deviceId, pluginName, viewType = 'view', format = 'json', language = 'en' } = args;
    
    let url = '/api/plugins/getView?';
    const params = new URLSearchParams();
    
    if (deviceId) {
      params.append('id', deviceId.toString());
    }
    if (pluginName) {
      params.append('name', pluginName);
    }
    if (viewType) {
      params.append('type', viewType);
    }
    
    url += params.toString();
    
    // For now, we'll use JSON format by default
    return await this.hc3.request(url);
  }

  private async updatePluginView(args: { 
    deviceId: number; 
    componentName: string; 
    propertyName: string; 
    newValue: any 
  }): Promise<any> {
    const { deviceId, componentName, propertyName, newValue } = args;
    const updateData = {
      deviceId,
      componentName,
      propertyName,
      newValue
    };
    return await this.hc3.request('/api/plugins/updateView', 'POST', updateData);
  }

  private async callUIEvent(args: { 
    deviceId: number; 
    elementName: string; 
    eventType: string; 
    value?: string 
  }): Promise<any> {
    const { deviceId, elementName, eventType, value } = args;
    
    let url = `/api/plugins/callUIEvent?deviceID=${deviceId}&elementName=${encodeURIComponent(elementName)}&eventType=${encodeURIComponent(eventType)}`;
    if (value) {
      url += `&value=${encodeURIComponent(value)}`;
    }
    
    return await this.hc3.request(url, 'GET');
  }

  private async createChildDevice(args: { 
    parentId: number; 
    type: string; 
    name: string; 
    initialProperties?: any; 
    initialInterfaces?: string[] 
  }): Promise<any> {
    const { parentId, type, name, initialProperties, initialInterfaces } = args;
    const deviceData = {
      parentId,
      type,
      name,
      ...(initialProperties && { initialProperties }),
      ...(initialInterfaces && { initialInterfaces })
    };
    return await this.hc3.request('/api/plugins/createChildDevice', 'POST', deviceData);
  }

  private async managePluginInterfaces(args: { 
    action: string; 
    deviceId: number; 
    interfaces: string[] 
  }): Promise<any> {
    const { action, deviceId, interfaces } = args;
    const requestData = {
      action,
      deviceId,
      interfaces
    };
    return await this.hc3.request('/api/plugins/interfaces', 'POST', requestData);
  }

  private async restartPlugin(args: { deviceId: number }): Promise<any> {
    const { deviceId } = args;
    const requestData = { deviceId };
    return await this.hc3.request('/api/plugins/restart', 'POST', requestData);
  }

  private async updateDeviceProperty(args: { 
    deviceId: number; 
    propertyName: string; 
    value: any 
  }): Promise<any> {
    const { deviceId, propertyName, value } = args;
    const requestData = {
      deviceId,
      propertyName,
      value
    };
    return await this.hc3.request('/api/plugins/updateProperty', 'POST', requestData);
  }

  private async publishPluginEvent(args: { 
    eventType: string; 
    source?: number; 
    data?: any 
  }): Promise<any> {
    const { eventType, source, data = {} } = args;
    
    let eventData: any = { type: eventType };
    
    if (source !== undefined) {
      eventData.source = source;
    }
    
    if (data && Object.keys(data).length > 0) {
      eventData.data = data;
    }
    
    return await this.hc3.request('/api/plugins/publishEvent', 'POST', eventData);
  }

  private async getIPCameras(args: any): Promise<any> {
    return await this.hc3.request('/api/plugins/ipCameras');
  }

  private async installPlugin(args: { type: string }): Promise<any> {
    const { type } = args;
    const url = `/api/plugins/installed?type=${encodeURIComponent(type)}`;
    return await this.hc3.request(url, 'POST');
  }

  private async deletePlugin(args: { type: string; allow_bulk?: boolean }): Promise<any> {
    const { type } = args;
    if (!type) throw new Error('delete_plugin requires type.');
    const devices: any[] = await this.hc3.request(`/api/devices?type=${encodeURIComponent(type)}`);
    if (devices.length > 1 && !args.allow_bulk) {
      throw new Error(
        `delete_plugin would uninstall ${devices.length} devices of type '${type}' (ids: ${devices.map(d => d.id).slice(0, 10).join(', ')}${devices.length > 10 ? ', …' : ''}). ` +
        `Pass allow_bulk=true to proceed, or use delete_device(deviceId) for a single-device removal.`
      );
    }
    const url = `/api/plugins/installed?type=${encodeURIComponent(type)}`;
    const res = await this.hc3.request(url, 'DELETE');
    return {
      type,
      devicesAffected: devices.length,
      deviceIds: devices.map(d => d.id),
      raw: res
    };
  }

  private errorResponse(id: string | number | undefined, code: number, message: string, data?: any): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    };
  }
}

// Start the server
const server = new HC3MCPServer();
