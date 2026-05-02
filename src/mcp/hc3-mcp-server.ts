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
import { deepEqual, deepMerge, verifyWrite, tolerantFetch } from './util';
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
import { icons } from './tools/icons';
import { intelligence } from './tools/intelligence';
import { system, systemSchemas } from './tools/system';
import { zwave, zwaveSchemas } from './tools/zwave';
import { snapshot } from './tools/snapshot';
import { docs } from './tools/docs';
import { plugins } from './tools/plugins';

const toolModules = [alarm, sprinklers, backups, debug, ios, climate, customEvents, notifications, globals, users, rooms, scenes, profiles, devices, quickapps, icons, intelligence, system, zwave, snapshot, docs, plugins];
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
      systemSchemas.get_system_info,
      systemSchemas.get_network_status,

      // Energy Management
      systemSchemas.get_energy_data,

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

      ...snapshot.schemas,

      ...icons.schemas,
      systemSchemas.get_diagnostics,
      zwaveSchemas.get_zwave_mesh_health,
      systemSchemas.get_refresh_states,
      systemSchemas.get_event_history,
      zwaveSchemas.get_device_parameters,
      zwaveSchemas.get_zwave_reconfiguration_tasks,
      zwaveSchemas.get_zwave_node_diagnostics,

      // Weather Information
      systemSchemas.get_weather,

      // Home/Away Status
      systemSchemas.get_home_status,
      systemSchemas.set_home_status,

      ...profiles.schemas,

      ...climate.schemas,

      ...alarm.schemas,

      ...sprinklers.schemas,

      ...customEvents.schemas,

      // Location Management
      systemSchemas.get_location_info,
      systemSchemas.update_location_settings,

      ...notifications.schemas,

      ...backups.schemas,

      ...debug.schemas,

      ...ios.schemas,

      ...quickappsCoreSchemas,
      ...intelligence.schemas,

      ...docs.schemas,

      ...quickappsExtSchemas,

      ...plugins.schemas,
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

      if (!(name in toolHandlers)) {
        throw new Error(`Unknown tool: ${name}`);
      }
      result = await toolHandlers[name](this.hc3, args);

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
