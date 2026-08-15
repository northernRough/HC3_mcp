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
import { listResources, readResource } from './resources';
import { recordFailure, invitesAFinding, FINDING_NUDGE } from './friction';
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
import { SERVER_NAME, SERVER_VERSION } from './version';

const toolModules = [alarm, sprinklers, backups, debug, ios, climate, customEvents, notifications, globals, users, rooms, scenes, profiles, devices, quickapps, icons, intelligence, system, zwave, snapshot, docs, plugins, audit];
const toolHandlers = mergeHandlers(toolModules);


/**
 * Sent once at initialize, so it reaches the client BEFORE any tool is
 * chosen. That makes it the only channel that lands at design time — a tool
 * description is read only when someone already reached for that tool, which
 * is too late for "how should I approach this at all".
 *
 * It is also the most expensive place to be wrong: every session pays for it
 * and no one can opt out. So the bar here is deliberately higher than for a
 * tool description — ONLY facts verified against a live gateway. Nothing
 * inherited, nothing merely documented, nothing reported-but-untested.
 *
 * That bar exists because it was earned. An earlier draft of this text would
 * have asserted that device icons are single-image sets and that every state
 * change must be code-driven. Both were wrong, taken from Fibaro's OpenAPI
 * spec rather than from the wire, and would have been injected into every
 * session until someone noticed. Two other long-standing claims in this
 * codebase — that HC3 rejects non-palette PNGs, and that import_quickapp
 * resolved a server-side path — also failed on contact with the gateway.
 *
 * If you are tempted to add a line here from documentation or a bug report,
 * test it first or leave it in the tool description where the blast radius
 * is one call instead of every conversation.
 */
const SERVER_INSTRUCTIONS = [
  'This server controls a live Fibaro Home Center 3 (firmware 5.2x) in someone\'s home. Every fact below was verified against a real gateway; several contradict Fibaro\'s own API documentation.',
  '',
  '- HC3 does not 404 a missing asset. It answers **200 with a placeholder**: a 1888-byte "unknown icon" SVG under /assets/icon, or its web UI index.html elsewhere. HTTP status alone never proves an asset exists — check the content.',
  '- Device icons are state SETS, and the set size is a property of the DEVICE TYPE: com.fibaro.genericDevice holds 1 image, binarySwitch 2 (states 0/100), multilevelSwitch 11 (0,10,...,100). HC3 switches between them from the device value on its own. Supplying the wrong shape fails silently: it registers, attaches, and renders blank.',
  '- Icon PNGs must be exactly 128x128 (HC3 answers 400 INVALID_ICON_SIZE); colour type does NOT matter, RGBA is fine. Icon names (User<N>) are unique only WITHIN a bucket and freed ids are reused, so never match an icon across buckets by name.',
  '- Writing scene or QuickApp Lua? Call get_hc3_lua_scenes_guide / get_hc3_quickapp_programming_guide first: they correct Fibaro\'s docs and widely repeated forum advice. Verified here: a firing scene timer does NOT restart the scene and closures survive.',
  '- Bodies are large: get_scenes returns every scene in full (~1.9 MB) — use get_scene, with startLine/endLine or contains to read part of one. patch_scene_content/patch_quickapp_file send only the change and refuse one that no longer fits.',
  '- Several documented endpoints return 501 here; KNOWN_DEAD_ENDPOINTS.md lists them. Prefer a tool over a hand-built path.',
  '- **A call that does not throw has not necessarily worked.** HC3 stores requests it will not act on, and reports success. Verified: fibaro.setGlobalVariable writes an EXISTING global fine but **silently does nothing** for one that does not exist — a heartbeat went into a void for a day. Likewise a QuickApp `select` missing `selectionType`, or with `values` as `{}` not `[]`, is stored and reported verified, then blanks the **entire** tile. After any write, read back what you care about, not the return code.',
  '- Writing a QuickApp variable from outside **restarts that QuickApp**, once per call — eight variables means eight restarts. Use update_multiple_quickapp_files for several files (one restart), and order variable writes before anything else that restarts.',
  '- Mutating tools read back and verify; errors are specific, so read them rather than retrying blind.',
  '- Tool schemas cache at connect; a reconnect may not refresh them, so start a NEW SESSION after a redeploy. get_server_info shows the live version even when yours are stale.',
  '',
  '**This server collects its own defects, and expects you to file them.** report_finding is not a courtesy — it is how the facts above got here, and how the next wrong one gets removed.',
  '- File it in the SAME TURN you discover it. Not at the end of the session: by then the exact error text and the sequence that produced it are gone, and a problem you worked around feels resolved when it is only hidden. Do not ask permission and do not wait to be asked.',
  '- Call it when: a tool that worked becomes unavailable; a documented path or parameter turns out to be wrong; a write reports success and a read-back disagrees; you find a working method this server does not document; **you conclude a capability is impossible**; or you build a workaround because a tool was missing or refused.',
  '- That impossible-capability case is the expensive one. A wrong negative conclusion is recorded as settled and steers every later session away from something that works. It is also the ONLY case worth raising with the user, because only they know what was abandoned on your say-so.',
  '- Unsure findings are wanted: write "not isolated" in the reproduction and file it anyway. Local only, redacted, nothing transmitted. A postponed finding is a lost one.',
  '',
  'At-a-glance read-only resources: hc3://health (anything broken), hc3://watchdog (automation alive), hc3://binder (bindings resolved), hc3://globals (automation state).',
].join('\n');

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
          return { jsonrpc: '2.0', id: request.id, result: { resources: listResources() } };
        case 'resources/read':
          return await this.handleReadResource(request);
        case 'prompts/list':
          return { jsonrpc: '2.0', id: request.id, result: { prompts: [] } };
        default:
          return this.errorResponse(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      return this.errorResponse(request.id, -32603, 'Internal error');
    }
  }

  /**
   * resources/read. Resources are read-only renderings, so a failure here is
   * reported as an error envelope rather than a partial document — a
   * half-rendered health view reads as "nothing wrong" and is worse than a
   * visible failure.
   */
  private async handleReadResource(request: MCPRequest): Promise<MCPResponse> {
    const uri = (request.params as any)?.uri;
    if (typeof uri !== 'string' || uri.length === 0) {
      return this.errorResponse(request.id, -32602, 'resources/read requires a string "uri" param.');
    }
    try {
      return { jsonrpc: '2.0', id: request.id, result: await readResource(this.hc3, uri) };
    } catch (error: any) {
      return this.errorResponse(request.id, -32000, `resources/read failed: ${error?.message ?? String(error)}`);
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
          // Read-only at-a-glance views (hc3://health, watchdog, binder,
          // globals). Declared so clients surface them; no subscribe support,
          // so listChanged is not advertised.
          resources: {},
        },
        instructions: SERVER_INSTRUCTIONS,
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
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
      systemSchemas.get_server_info,
      systemSchemas.report_finding,
      systemSchemas.get_system_info,
      systemSchemas.get_hc3_time,
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
      // Tool EXECUTION failures come back as a normal result carrying
      // isError, not as a JSON-RPC protocol error. Protocol errors are for
      // protocol faults (unknown method, malformed params); many clients
      // render them as a generic envelope and drop the text, which is how a
      // user spent two days seeing only "Error occurred during tool
      // execution" while this server was in fact reporting HTTP status and
      // HC3's response body all along. As isError content the message
      // reaches the model and the user verbatim.
      const errorMessage = error instanceof Error ? error.message : String(error);
      const toolName = (request.params as any)?.name ?? 'unknown';
      // Local, redacted, best-effort. Never allowed to affect the response.
      recordFailure(toolName, errorMessage);
      // An error is the moment a finding is cheapest to write and likeliest to
      // be skipped, so ask for it here rather than hoping it is remembered.
      const text = invitesAFinding(toolName, errorMessage)
        ? errorMessage + FINDING_NUDGE
        : errorMessage;
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          isError: true,
          content: [{ type: 'text', text }],
        },
      };
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
