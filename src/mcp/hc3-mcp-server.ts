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
import { globals, deleteGlobalVariableSchema } from './tools/globals';
import { users, usersSchemas } from './tools/users';
import { rooms } from './tools/rooms';
import { scenes } from './tools/scenes';
import { profiles } from './tools/profiles';
import { devices, deleteDeviceSchema } from './tools/devices';
import { quickapps, quickappsCoreSchemas, quickappsExtSchemas } from './tools/quickapps';
import { icons } from './tools/icons';
import { intelligence } from './tools/intelligence';
import { system, systemSchemas } from './tools/system';
import { zwave, zwaveSchemas } from './tools/zwave';
import { snapshot } from './tools/snapshot';
import { docs } from './tools/docs';
import { plugins } from './tools/plugins';
import { audit } from './tools/audit';

const toolModules = [alarm, sprinklers, backups, debug, ios, climate, customEvents, notifications, globals, users, rooms, scenes, profiles, devices, quickapps, icons, intelligence, system, zwave, snapshot, docs, plugins, audit];
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
          version: '4.2.2',
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

      usersSchemas.update_user_rights,

      ...globals.schemas,

      // User Management
      usersSchemas.get_users,

      ...snapshot.schemas,

      ...icons.schemas,
      systemSchemas.get_diagnostics,
      zwaveSchemas.get_zwave_mesh_health,
      systemSchemas.get_refresh_states,
      systemSchemas.get_event_history,
      zwaveSchemas.get_device_parameters,
      zwaveSchemas.set_device_parameter,
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
      deleteDeviceSchema,
      deleteGlobalVariableSchema,

      ...audit.schemas,
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
