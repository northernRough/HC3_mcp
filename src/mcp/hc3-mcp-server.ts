#!/usr/bin/env node

/**
 * Fibaro HC3 MCP Server
 * A comprehensive MCP server implementation for Fibaro Home Center 3 REST API integration
 * Based on the official Fibaro HC3 API documentation
 */

interface MCPRequest {
  jsonrpc: string;
  id?: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

class HC3MCPServer {
  private config: {
    host?: string;
    username?: string;
    password?: string;
    port?: number;
  } = {};

  constructor() {
    // Get configuration from environment variables
    this.config = {
      host: process.env.FIBARO_HOST,
      username: process.env.FIBARO_USERNAME,
      password: process.env.FIBARO_PASSWORD,
      port: process.env.FIBARO_PORT ? parseInt(process.env.FIBARO_PORT) : 80,
    };

    const transport = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();
    if (transport === 'http') {
      this.setupHttpHandler();
    } else {
      this.setupStdioHandler();
    }
  }

  private setupStdioHandler(): void {
    process.stdin.setEncoding('utf8');
    
    let buffer = '';
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;

      // Process complete JSON-RPC messages
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          this.handleMessage(line).then(resp => {
            if (resp) this.sendResponse(resp);
          });
        }
      }
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });

    // Log server startup to stderr (not stdout which is used for MCP communication)
    console.error('Fibaro HC3 MCP server running on stdio');
  }

  private setupHttpHandler(): void {
    const http = require('node:http') as typeof import('node:http');
    const host = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
    const port = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT) : 3000;
    const expected = process.env.MCP_HTTP_TOKEN;
    if (!expected || expected.length < 16) {
      console.error('MCP_HTTP_TOKEN must be set (>= 16 chars) when MCP_TRANSPORT=http. Refusing to start.');
      process.exit(1);
    }
    const expectedBuf = Buffer.from(expected, 'utf8');

    const constantTimeEq = (a: string): boolean => {
      const ab = Buffer.from(a, 'utf8');
      if (ab.length !== expectedBuf.length) return false;
      const crypto = require('node:crypto') as typeof import('node:crypto');
      return crypto.timingSafeEqual(ab, expectedBuf);
    };

    const writeJson = (res: import('node:http').ServerResponse, status: number, body: any) => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(text),
      });
      res.end(text);
    };

    const server = http.createServer(async (req, res) => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';

      if (method === 'GET' && url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok\n');
        return;
      }

      // Bearer auth on every other path.
      const authHeader = req.headers['authorization'];
      const supplied = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
      if (!supplied || !constantTimeEq(supplied)) {
        writeJson(res, 401, { error: 'unauthorized' });
        return;
      }

      if (method === 'GET' && url === '/mcp') {
        // SSE stream for server-initiated messages and notifications.
        // Held open with periodic keep-alive comments. Currently the server
        // does not push notifications proactively, so this is mostly a
        // protocol-conformance stub clients can subscribe to.
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store',
          'Connection': 'keep-alive',
        });
        res.write(': hc3-mcp sse stream\n\n');
        const ka = setInterval(() => res.write(': ka\n\n'), 25000);
        req.on('close', () => clearInterval(ka));
        return;
      }

      if (method === 'POST' && url === '/mcp') {
        // Read body with a 1 MB cap.
        const chunks: Buffer[] = [];
        let total = 0;
        const MAX = 1024 * 1024;
        let aborted = false;
        req.on('data', (c: Buffer) => {
          total += c.length;
          if (total > MAX) {
            aborted = true;
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', async () => {
          if (aborted) {
            writeJson(res, 413, { error: 'payload too large' });
            return;
          }
          const body = Buffer.concat(chunks).toString('utf8');
          // Log without arguments (which can contain credentials).
          let methodForLog = '?';
          try { methodForLog = JSON.parse(body).method ?? '?'; } catch {}
          console.error(`[http] ${req.socket.remoteAddress} POST /mcp method=${methodForLog} ${total}b`);

          const response = await this.handleMessage(body);
          if (response === null) {
            // Notification — no body, 202 Accepted per MCP spec convention.
            res.writeHead(202).end();
            return;
          }
          writeJson(res, 200, response);
        });
        req.on('error', () => {
          if (!res.headersSent) writeJson(res, 400, { error: 'bad request' });
        });
        return;
      }

      writeJson(res, 404, { error: 'not found' });
    });

    server.listen(port, host, () => {
      console.error(`Fibaro HC3 MCP server running on HTTP at http://${host}:${port}/mcp (bearer auth required)`);
      // Startup smoke test: confirm HC3 reachability so that a misconfigured
      // .env shows up in the logs immediately, not only on first user request.
      void this.makeApiRequest('/api/settings/info')
        .then((info: any) => {
          const v = info?.softVersion ?? '?';
          const sn = info?.serialNumber ?? '?';
          console.error(`HC3 reachable at ${this.config.host}:${this.config.port} — softVersion ${v}, serial ${sn}`);
        })
        .catch((e: any) => {
          console.error(`HC3 reachability check FAILED: ${e?.message ?? e}. Server is running but tool calls will fail until HC3 credentials/network are correct.`);
        });
    });
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
          version: '0.1.0',
        },
      },
    };
  }

  private handleListTools(request: MCPRequest): MCPResponse {
    const tools: MCPTool[] = [
      // Device Management
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
              description: 'Nested device properties to modify (e.g., {saveLogs: false, icon: {...}, manufacturer: "..."}). Sent under properties.* in the PUT body. This is the wrapper HC3 requires for nested updates. Rejected here: quickAppVariables (use set_quickapp_variable); parameters / associations / multichannelAssociations (HC3 firmware 5.x caches Z-wave mesh-config writes without transmitting — set via HC3 Web UI). Other array-valued properties like categories / uiCallbacks require the full current array to be submitted (partial submissions destroy omitted entries).',
            },
          },
          required: ['deviceId'],
        },
      },

      // Room Management
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

      // Scene Management
      {
        name: 'get_scenes',
        description: 'Get all scenes from Fibaro HC3, with optional filtering by room',
        inputSchema: {
          type: 'object',
          properties: {
            roomId: {
              type: 'number',
              description: 'Optional: Filter scenes by room ID',
            },
            alexaProhibited: {
              type: 'boolean',
              description: 'Optional: Filter scenes by Alexa prohibition status',
            },
          },
        },
      },
      {
        name: 'run_scene',
        description: 'Execute a scene by ID',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
          },
          required: ['sceneId'],
        },
      },
      {
        name: 'stop_scene',
        description: 'Stop a running scene by ID',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
          },
          required: ['sceneId'],
        },
      },
      {
        name: 'run_scene_sync',
        description: 'Run a scene synchronously via POST /api/scenes/{id}/executeSync. Unlike run_scene (fires async and returns immediately), this waits until the scene has finished running before returning. Useful for sequencing dependent automation steps. Returns HC3\'s response (204 No Content on success — no return payload).',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: { type: 'number', description: 'Scene ID' }
          },
          required: ['sceneId']
        }
      },
      {
        name: 'modify_scene',
        description: 'Modify top-level scene metadata (name, enabled, maxRunningInstances, restart, hidden, stopOnAlarm, protectedByPin, mode, roomId, icon, description, categories). Does not modify scene content (conditions/actions) — use update_scene_content for that.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
            properties: {
              type: 'object',
              description: 'Scene fields to update. Any subset of the fields below is accepted; fields not supplied are left unchanged.',
              properties: {
                name: { type: 'string' },
                enabled: { type: 'boolean' },
                maxRunningInstances: { type: 'number' },
                restart: { type: 'boolean' },
                hidden: { type: 'boolean' },
                stopOnAlarm: { type: 'boolean' },
                protectedByPin: { type: 'boolean' },
                mode: { type: 'string', enum: ['automatic', 'manual'] },
                roomId: { type: 'number' },
                icon: { type: 'string' },
                description: { type: 'string' },
                categories: { type: 'array', items: { type: 'number' } },
              },
              additionalProperties: false,
            },
          },
          required: ['sceneId', 'properties'],
        },
      },
      {
        name: 'create_scene',
        description: 'Create a new scene via POST /api/scenes. Post-create verify: refetches /api/scenes/{newId} and confirms name + type match. Guards: name must be 1–50 chars (HC3 silently truncates / rejects otherwise); type must be "lua" or "scenario". If content is an object it is JSON.stringify\'d before sending (matches update_scene_content semantics).',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Scene name (1–50 chars).' },
            type: { type: 'string', enum: ['lua', 'scenario'], description: 'Scene type.' },
            roomId: { type: 'number', description: 'Room id (required). Use get_rooms to find a valid id — HC3 rejects roomId=0 on creation.' },
            content: { description: 'Scene body. String or object (object is JSON.stringify\'d).' },
            maxRunningInstances: { type: 'number', description: 'Default 1.' },
            enabled: { type: 'boolean', description: 'Default true.' },
            hidden: { type: 'boolean', description: 'Default false.' },
            icon: { type: 'string', description: 'Icon id. Default "scene_icon_icon_scene1".' },
            categories: { type: 'array', items: { type: 'number' }, description: 'Category ids (HC3 rejects empty). Defaults to [1].' }
          },
          required: ['name', 'type', 'roomId']
        }
      },
      {
        name: 'update_scene_content',
        description: 'Update the Lua content (actions and/or conditions) of a Lua-type scene. If only one of actions/conditions is supplied, the other is preserved. Returns both previous and current content so the caller has a last-known-good copy for recovery.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'number',
              description: 'Scene ID',
            },
            actions: {
              type: 'string',
              description: 'Lua source for the scene actions block. If omitted, existing actions are preserved.',
            },
            conditions: {
              type: 'string',
              description: 'Conditions block source (Lua table as a string). If omitted, existing conditions are preserved. Only valid for Lua-type scenes.',
            },
          },
          required: ['sceneId'],
        },
      },

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

      // Global Variables
      {
        name: 'get_global_variables',
        description: 'Get all global variables from the HC3 system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'set_global_variable',
        description: 'Set the value of a global variable',
        inputSchema: {
          type: 'object',
          properties: {
            varName: {
              type: 'string',
              description: 'Variable name',
            },
            value: {
              type: ['string', 'number', 'boolean'],
              description: 'Variable value',
            },
          },
          required: ['varName', 'value'],
        },
      },
      {
        name: 'create_global_variable',
        description: 'Create a new global variable via POST /api/globalVariables. Refuses if the variable already exists (use set_global_variable to update). Pre-validates name format (HC3 requires [A-Za-z][A-Za-z0-9_]*). Supports isEnum globals with an enumValues list. Post-create verifies by refetching and asserting the stored value matches.',
        inputSchema: {
          type: 'object',
          properties: {
            varName: {
              type: 'string',
              description: 'Variable name. Must match [A-Za-z][A-Za-z0-9_]* (HC3 regex).'
            },
            value: {
              type: ['string', 'number', 'boolean'],
              description: 'Initial value. For isEnum globals must be one of enumValues.'
            },
            readOnly: {
              type: 'boolean',
              description: 'Mark as read-only system-style variable. Default false.'
            },
            isEnum: {
              type: 'boolean',
              description: 'Create as enum variable. Default false.'
            },
            enumValues: {
              type: 'array',
              items: { type: 'string' },
              description: 'Allowed enum values. Required when isEnum=true.'
            }
          },
          required: ['varName', 'value']
        }
      },

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
      {
        name: 'get_profiles',
        description: 'List all HC3 profiles plus the activeProfile id. Profiles group scenes/climateZones/partitions/devices into mode-based orchestrations (Home/Away/Vacation/Night). Wraps GET /api/profiles.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_profile',
        description: 'Get a single profile by id. Wraps GET /api/profiles/{id}.',
        inputSchema: {
          type: 'object',
          properties: { profileId: { type: 'number', description: 'Profile id' } },
          required: ['profileId']
        }
      },
      {
        name: 'activate_profile',
        description: 'Switch the active profile via POST /api/profiles/activeProfile/{id}. Triggers HC3\'s profile-activation cascade: scenes listed as "kill on activate" are killed, scenes listed as "run on activate" are run, etc. Post-activation verifies by refetching /api/profiles and confirming activeProfile has changed. Use this as the agent-level equivalent of tapping a mode button in the HC3 mobile app.',
        inputSchema: {
          type: 'object',
          properties: { profileId: { type: 'number', description: 'Profile id to activate' } },
          required: ['profileId']
        }
      },
      {
        name: 'modify_profile',
        description: 'Modify a profile\'s configuration (name, iconId, or the devices / scenes / climateZones / partitions arrays that define what the profile orchestrates). Follows the standard read-modify-write + post-write-verify pattern: reads current, deep-merges submitted fields, PUTs, refetches, asserts merge result matches. Wraps PUT /api/profiles/{id}.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id to modify' },
            fields: {
              type: 'object',
              description: 'Partial update. Any of: name (string), iconId (number), devices (array), scenes (array), climateZones (array), partitions (array). Array fields fully replace — HC3 PUT semantics on array-valued properties.'
            }
          },
          required: ['profileId', 'fields']
        }
      },
      {
        name: 'create_profile',
        description: 'Create a new HC3 profile via POST /api/profiles. Post-create verify: refetches the profile and confirms the name matches. Returns the HC3-assigned profileId.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display name for the new profile.' },
            iconId: { type: 'number', description: 'Optional icon id (HC3 profile icon catalogue).' }
          },
          required: ['name']
        }
      },
      {
        name: 'delete_profile',
        description: 'Delete a profile via DELETE /api/profiles/{id}. Guards: refuses if the profile is the currently active one (you cannot delete the active profile without switching first). Post-delete verifies by refetch expecting 404.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id to delete' }
          },
          required: ['profileId']
        }
      },
      {
        name: 'reset_profiles',
        description: 'DESTRUCTIVE: reset all profiles to HC3 defaults via POST /api/profiles/reset. Wipes all custom profile configuration (device lists, scene actions, climate-zone actions, partition actions) across every profile. Requires confirm=true. No undo.',
        inputSchema: {
          type: 'object',
          properties: {
            confirm: { type: 'boolean', description: 'Must be true to proceed. Any other value refuses.' }
          },
          required: ['confirm']
        }
      },
      {
        name: 'set_profile_scene_action',
        description: 'Set how a profile handles a specific scene when activated. Wraps PUT /api/profiles/{profileId}/scenes/{sceneId}. Body: {actions: [...]} where actions is an array of scene-action strings (e.g. ["execute"], ["kill"], ["setToAuto"]). The scene must already be present in the profile\'s scenes array (use modify_profile to add first).',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id' },
            sceneId: { type: 'number', description: 'Scene id within the profile' },
            actions: { type: 'array', items: { type: 'string' }, description: 'Action strings. Examples: "execute", "kill", "setToAuto".' }
          },
          required: ['profileId', 'sceneId', 'actions']
        }
      },
      {
        name: 'set_profile_climate_zone_action',
        description: 'Set how a profile handles a specific climate zone when activated. Wraps PUT /api/profiles/{profileId}/climateZones/{zoneId}. Body: {mode, properties}. Mode values observed: "Manual", "Auto", others per firmware. Properties vary by mode (e.g. handMode="Heat", handSetPointHeating=21 for Manual).',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id' },
            zoneId: { type: 'number', description: 'Climate zone id' },
            mode: { type: 'string', description: 'Mode (e.g. Manual, Auto).' },
            properties: { type: 'object', description: 'Mode-specific properties (e.g. {handMode, handSetPointHeating}).' }
          },
          required: ['profileId', 'zoneId', 'mode']
        }
      },
      {
        name: 'set_profile_partition_action',
        description: 'Set how a profile handles a specific alarm partition when activated. Wraps PUT /api/profiles/{profileId}/partitions/{partitionId}. Body: {action} where action is typically "arm", "disarm", or null.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'number', description: 'Profile id' },
            partitionId: { type: 'number', description: 'Alarm partition id' },
            action: { type: ['string', 'null'], description: 'Partition action (e.g. "arm", "disarm") or null for no-op.' }
          },
          required: ['profileId', 'partitionId']
        }
      },

      // Climate Management
      {
        name: 'get_climate_zones',
        description: 'Get all climate zones',
        inputSchema: {
          type: 'object',
          properties: {
            detailed: {
              type: 'boolean',
              description: 'Return detailed climate zone information (default: false)',
            },
          },
        },
      },
      {
        name: 'get_climate_zone',
        description: 'Get specific climate zone by ID',
        inputSchema: {
          type: 'object',
          properties: {
            zoneId: {
              type: 'number',
              description: 'Climate zone ID',
            },
          },
          required: ['zoneId'],
        },
      },
      {
        name: 'update_climate_zone',
        description: 'Update climate zone fields in a single atomic PUT. Use `topLevel` for zone-body fields (e.g., `name`, `active`, `mode`) and `properties` for nested zone properties (e.g., `handSetPointHeating`, `vacationMode`, schedule objects like `monday.morning`). At least one must be provided. `properties` is written via read-modify-write: the tool fetches the current zone, deep-merges submitted scalars and nested-object keys into the existing properties, then PUTs the merged result. This preserves unsubmitted sibling keys inside schedule sub-objects. Array-valued properties (`devices`, `incompatibleDevices`, `temperatureSensors`) are fully replaced by whatever is submitted, so submit the complete array if editing them. Writes are verified by refetching and comparing each submitted field; throws on any mismatch rather than silently succeeding.',
        inputSchema: {
          type: 'object',
          properties: {
            zoneId: {
              type: 'number',
              description: 'Climate zone ID',
            },
            topLevel: {
              type: 'object',
              description: 'Top-level zone fields to modify (e.g., {name: "New Name", active: true, mode: "Schedule"}). Sent at the root of the PUT body.',
            },
            properties: {
              type: 'object',
              description: 'Nested zone properties to modify. Scalars (handSetPointHeating, vacationMode, etc.) and schedule sub-objects (monday.morning, etc.) are deep-merged into the current zone via read-modify-write, so sibling keys are preserved. Array-valued properties (devices, incompatibleDevices, temperatureSensors) are fully replaced — submit the full current array if editing them.',
            },
          },
          required: ['zoneId'],
        },
      },

      // Alarm System Management
      {
        name: 'get_alarm_partitions',
        description: 'Get all alarm partitions',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_alarm_partition',
        description: 'Get specific alarm partition by ID',
        inputSchema: {
          type: 'object',
          properties: {
            partitionId: {
              type: 'number',
              description: 'Alarm partition ID',
            },
          },
          required: ['partitionId'],
        },
      },
      {
        name: 'arm_alarm_partition',
        description: 'Arm alarm partition',
        inputSchema: {
          type: 'object',
          properties: {
            partitionId: {
              type: 'number',
              description: 'Alarm partition ID',
            },
            armingType: {
              type: 'string',
              description: 'Arming type (full, partial, night)',
              enum: ['full', 'partial', 'night'],
            },
          },
          required: ['partitionId', 'armingType'],
        },
      },
      {
        name: 'disarm_alarm_partition',
        description: 'Disarm alarm partition',
        inputSchema: {
          type: 'object',
          properties: {
            partitionId: {
              type: 'number',
              description: 'Alarm partition ID',
            },
          },
          required: ['partitionId'],
        },
      },
      {
        name: 'get_alarm_history',
        description: 'Get alarm system history',
        inputSchema: {
          type: 'object',
          properties: {
            partitionId: {
              type: 'number',
              description: 'Optional: Filter by partition ID',
            },
            limit: {
              type: 'number',
              description: 'Limit number of results (default: 100)',
            },
            offset: {
              type: 'number',
              description: 'Offset for pagination (default: 0)',
            },
          },
        },
      },
      {
        name: 'get_alarm_devices',
        description: 'Get alarm system devices',
        inputSchema: {
          type: 'object',
          properties: {
            partitionId: {
              type: 'number',
              description: 'Optional: Filter by partition ID',
            },
          },
        },
      },

      // Sprinkler System Management
      {
        name: 'get_sprinkler_systems',
        description: 'Get all sprinkler systems',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_sprinkler_system',
        description: 'Get specific sprinkler system by ID',
        inputSchema: {
          type: 'object',
          properties: {
            systemId: {
              type: 'number',
              description: 'Sprinkler system ID',
            },
          },
          required: ['systemId'],
        },
      },
      {
        name: 'control_sprinkler_system',
        description: 'Control sprinkler system (start, stop, pause)',
        inputSchema: {
          type: 'object',
          properties: {
            systemId: {
              type: 'number',
              description: 'Sprinkler system ID',
            },
            action: {
              type: 'string',
              description: 'Action to perform',
              enum: ['start', 'stop', 'pause', 'resume'],
            },
            zoneId: {
              type: 'number',
              description: 'Optional: Specific zone ID for zone-specific actions',
            },
            duration: {
              type: 'number',
              description: 'Optional: Duration in minutes for start action',
            },
          },
          required: ['systemId', 'action'],
        },
      },

      // Custom Events Management
      {
        name: 'get_custom_events',
        description: 'Get all custom events',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'create_custom_event',
        description: 'Create a new custom event',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Event name',
            },
            userDescription: {
              type: 'string',
              description: 'Event description',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'trigger_custom_event',
        description: 'Trigger a custom event',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: {
              type: 'number',
              description: 'Custom event ID',
            },
          },
          required: ['eventId'],
        },
      },
      {
        name: 'get_custom_event',
        description: 'Read a single custom event by name. Wraps GET /api/customEvents/{name}. Returns {name, userDescription}. HTTP 404 if unknown.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Custom event name' }
          },
          required: ['name']
        }
      },
      {
        name: 'update_custom_event',
        description: 'Update a custom event\'s userDescription and/or rename it. Wraps PUT /api/customEvents/{name}. Read-modify-write: reads current, merges submitted fields, PUTs. If newName is supplied, verifies by refetching via the new name. Otherwise verifies under the original name. Throws on mismatch.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Current custom event name' },
            userDescription: { type: 'string', description: 'New description. Omit to leave unchanged.' },
            newName: { type: 'string', description: 'New name. Omit to leave unchanged.' }
          },
          required: ['name']
        }
      },
      {
        name: 'delete_custom_event',
        description: 'Delete a custom event by name. Wraps DELETE /api/customEvents/{name}. Reads the event first to capture userDescription as a recovery trail. Post-delete verifies by refetch expecting 404.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Custom event name to delete' }
          },
          required: ['name']
        }
      },

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

      // Notifications Management
      {
        name: 'get_notifications',
        description: 'Get system notifications',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Limit number of results (default: 50)',
            },
            offset: {
              type: 'number',
              description: 'Offset for pagination (default: 0)',
            },
          },
        },
      },
      {
        name: 'mark_notification_read',
        description: 'Mark notification as read',
        inputSchema: {
          type: 'object',
          properties: {
            notificationId: {
              type: 'number',
              description: 'Notification ID',
            },
          },
          required: ['notificationId'],
        },
      },
      {
        name: 'clear_all_notifications',
        description: 'Clear all notifications',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_notification',
        description: 'Read a single notification by id. Wraps GET /api/notificationCenter/{id}. 404 if unknown.',
        inputSchema: {
          type: 'object',
          properties: { notificationId: { type: 'number', description: 'Notification id' } },
          required: ['notificationId']
        }
      },
      {
        name: 'update_notification',
        description: 'Update a notification via PUT /api/notificationCenter/{id}. Read-modify-write + post-write verify on submitted fields. Typically used to mark as read or to amend the data payload.',
        inputSchema: {
          type: 'object',
          properties: {
            notificationId: { type: 'number', description: 'Notification id' },
            fields: { type: 'object', description: 'Partial update (wasRead, priority, data, canBeDeleted, etc.)' }
          },
          required: ['notificationId', 'fields']
        }
      },
      {
        name: 'delete_notification',
        description: 'Delete a notification via DELETE /api/notificationCenter/{id}. Reads first to capture the data payload as a recovery trail. Refuses if canBeDeleted=false (HC3-system-protected) unless allow_system=true. Post-delete verifies by refetch expecting 404.',
        inputSchema: {
          type: 'object',
          properties: {
            notificationId: { type: 'number', description: 'Notification id' },
            allow_system: { type: 'boolean', description: 'Required to delete notifications where canBeDeleted=false. Default false.' }
          },
          required: ['notificationId']
        }
      },

      // Backup Management
      {
        name: 'can_create_backup',
        description: 'Check if backups can be created',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_local_backup_status',
        description: 'Get local backup status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_remote_backup_status',
        description: 'Get remote backup status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_backups',
        description: 'Get list of available backups',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Backup type (local, remote, all)',
              enum: ['local', 'remote', 'all'],
            },
          },
        },
      },
      {
        name: 'create_backup',
        description: 'Create a new backup',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Backup name',
            },
            type: {
              type: 'string',
              description: 'Backup type (local, remote)',
              enum: ['local', 'remote'],
            },
          },
          required: ['name', 'type'],
        },
      },

      // Debug Messages
      {
        name: 'clear_debug_messages',
        description: 'Clear all debug messages on HC3 via DELETE /api/debugMessages. Useful for test loops — clear before running a scene or QA action, then read get_debug_messages to see only the fresh logs. Read-then-delete: counts messages before deletion so the response reports how many were cleared.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_debug_messages',
        description: 'Read HC3 debug messages with client-side filtering. HC3 returns a fixed page of 30 messages newest-first and ignores query-param filters, so this tool paginates via the "last" cursor and applies filters locally. Returns a summary object plus the matching messages.',
        inputSchema: {
          type: 'object',
          properties: {
            tagContains: {
              type: 'string',
              description: 'Case-insensitive substring match against the message tag (e.g. "DAIKIN" matches "DAIKIN-4710").',
            },
            since: {
              type: 'number',
              description: 'Epoch seconds. Only messages with timestamp >= this value are returned. Also stops pagination once the oldest fetched page is older than this.',
            },
            type: {
              type: 'string',
              description: 'Filter by message type.',
              enum: ['error', 'warning', 'info', 'debug', 'trace'],
            },
            limit: {
              type: 'number',
              description: 'Maximum number of matching messages to return (default: 100). Applied AFTER filtering.',
            },
            maxPages: {
              type: 'number',
              description: 'Safety cap on HC3 pages fetched (default: 10, ~300 raw messages). Raise if a filter needs deeper history.',
            },
          },
        },
      },

      // iOS Devices Management
      {
        name: 'get_ios_devices',
        description: 'Get registered iOS devices',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'register_ios_device',
        description: 'Register a new iOS device',
        inputSchema: {
          type: 'object',
          properties: {
            deviceToken: {
              type: 'string',
              description: 'iOS device token',
            },
            name: {
              type: 'string',
              description: 'Device name',
            },
          },
          required: ['deviceToken', 'name'],
        },
      },

      // QuickApp Management
      {
        name: 'get_quickapps',
        description: 'Get all QuickApps',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_quickapp',
        description: 'Get specific QuickApp by ID',
        inputSchema: {
          type: 'object',
          properties: {
            quickAppId: {
              type: 'number',
              description: 'QuickApp ID',
            },
          },
          required: ['quickAppId'],
        },
      },
      {
        name: 'restart_quickapp',
        description: 'Restart a QuickApp',
        inputSchema: {
          type: 'object',
          properties: {
            quickAppId: {
              type: 'number',
              description: 'QuickApp ID',
            },
          },
          required: ['quickAppId'],
        },
      },
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

      // QuickApp file manipulation tools
      {
        name: "list_quickapp_files",
        description: "Get list of all source files for a QuickApp. Returns file names, types, and metadata without file content.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            }
          },
          required: ["deviceId"]
        }
      },
      {
        name: "get_quickapp_file",
        description: "Get detailed information about a specific QuickApp file including its content.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            fileName: {
              type: "string",
              description: "Name of the file to retrieve"
            }
          },
          required: ["deviceId", "fileName"]
        }
      },
      {
        name: "create_quickapp_file",
        description: "Create a new source file for a QuickApp.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            name: {
              type: "string",
              description: "Name of the new file"
            },
            type: {
              type: "string",
              description: "Type of file (typically 'lua')",
              default: "lua"
            },
            content: {
              type: "string",
              description: "Content of the new file",
              default: ""
            },
            isOpen: {
              type: "boolean",
              description: "Whether the file should be open in the editor",
              default: false
            }
          },
          required: ["deviceId", "name"]
        }
      },
      {
        name: "update_quickapp_file",
        description: "Update an existing QuickApp source file.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            fileName: {
              type: "string",
              description: "Name of the file to update"
            },
            content: {
              type: "string",
              description: "New content for the file"
            },
            isOpen: {
              type: "boolean",
              description: "Whether the file should be open in the editor"
            }
          },
          required: ["deviceId", "fileName"]
        }
      },
      {
        name: "update_multiple_quickapp_files",
        description: "Update multiple QuickApp source files at once.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            files: {
              type: "array",
              description: "Array of files to update",
              items: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "File name"
                  },
                  content: {
                    type: "string",
                    description: "File content"
                  },
                  type: {
                    type: "string",
                    description: "File type"
                  },
                  isOpen: {
                    type: "boolean",
                    description: "Whether file should be open"
                  }
                },
                required: ["name", "content"]
              }
            }
          },
          required: ["deviceId", "files"]
        }
      },
      {
        name: "get_quickapp_variable",
        description: "Read a single QuickApp variable, returning its declared type and current value. Use this instead of parsing quickAppVariables from get_device_info when you only need one.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            name: {
              type: "string",
              description: "Variable name"
            }
          },
          required: ["deviceId", "name"]
        }
      },
      {
        name: "set_quickapp_variable",
        description: "Set a QuickApp variable via PUT /api/devices/{id} with the properties.quickAppVariables wrapper (the HC3 UI's save pattern). Reads the declared type first, writes with type preserved (avoids HC3's numeric-string coercion quirk), then verifies post-write state and throws on mismatch rather than silently succeeding. Variable must already exist; create new variables via the HC3 UI. Caveat: numeric-looking string values (e.g. \"3.0\") lose their exact lexical form crossing the MCP JSON boundary — the harness parses the input as a number, then this tool stringifies it (String(3.0) === \"3\"). If you need a specific numeric-string literal preserved verbatim, write it via modify_device with a full properties.quickAppVariables array (include every existing variable — HC3 does a full-array replace on PUT, so any variable omitted from the submission will be destroyed).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            name: {
              type: "string",
              description: "Variable name. Must already exist on the device."
            },
            value: {
              type: ["string", "number", "boolean"],
              description: "Value to set. Will be coerced to match the variable's declared type. For string-typed variables, numeric inputs are stringified to preserve type."
            }
          },
          required: ["deviceId", "name", "value"]
        }
      },
      {
        name: "delete_quickapp_file",
        description: "Delete a QuickApp source file. Note: main files cannot be deleted.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            fileName: {
              type: "string",
              description: "Name of the file to delete"
            }
          },
          required: ["deviceId", "fileName"]
        }
      },
      {
        name: "export_quickapp",
        description: "Export a QuickApp to .fqa (open source) or .fqax (encrypted) file. Wraps POST /api/quickApp/export/{deviceId}. Encrypted export produces a .fqax locked to a list of HC3 serial numbers — only those controllers can import it. Use encrypted + serialNumbers together when distributing a QA to specific third-party HC3 units without allowing further redistribution; leave encrypted false (default) for ordinary backup or sharing to anyone.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            encrypted: {
              type: "boolean",
              description: "Whether to export as encrypted .fqax file",
              default: false
            },
            serialNumbers: {
              type: "array",
              description: "List of serial numbers allowed to import (required for encrypted export)",
              items: {
                type: "string"
              }
            }
          },
          required: ["deviceId"]
        }
      },
      {
        name: "import_quickapp",
        description: "Import a QuickApp from .fqa/.fqax file.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Path to the .fqa/.fqax file to import"
            },
            roomId: {
              type: "number",
              description: "Room ID where the QuickApp should be created"
            }
          },
          required: ["filePath"]
        }
      },
      {
        name: "create_quickapp",
        description: "Create a new empty QuickApp on HC3 from scratch (not from a .fqa file — use import_quickapp for that). Wraps POST /api/quickApp. The new QA gets a blank Lua main file; use create_quickapp_file / update_multiple_quickapp_files to populate it afterwards. Returns the created device with its HC3-assigned deviceId. Verifies the write by refetching the device and confirming name + type match. Use get_quickapp_available_types to discover valid `type` values before calling this.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Display name for the new QuickApp."
            },
            type: {
              type: "string",
              description: "Fibaro device type, e.g. 'com.fibaro.temperatureSensor', 'com.fibaro.binarySwitch', 'com.fibaro.genericDevice'. Call get_quickapp_available_types for the full firmware-current list."
            },
            roomId: {
              type: "number",
              description: "Room ID the new QA should belong to (from get_rooms). Defaults to the Default Room if omitted."
            },
            initialProperties: {
              type: "object",
              description: "Optional map of initial device properties (e.g. quickAppVariables, icon, deviceRole)."
            },
            initialInterfaces: {
              type: "array",
              description: "Optional list of Fibaro interface names to attach at creation time.",
              items: { type: "string" }
            },
            initialView: {
              type: "object",
              description: "Optional initial UI view definition (see HC3 QuickApp view schema)."
            }
          },
          required: ["name", "type"]
        }
      },
      {
        name: "get_quickapp_available_types",
        description: "List the QuickApp device types that the current HC3 firmware knows about. Returns an array of {type, label} pairs — e.g. {type: 'com.fibaro.temperatureSensor', label: 'Temperature sensor'}. Use as the authoritative list when picking a `type` for create_quickapp or when validating plua `--%%type=...` headers. Wraps GET /api/quickApp/availableTypes.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },

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

      switch (name) {
        // Device Management
        case 'get_devices':
          result = await this.getDevices(args);
          break;
        case 'get_device_info':
          result = await this.getDeviceInfo(args);
          break;
        case 'filter_devices':
          result = await this.filterDevices(args);
          break;
        case 'find_devices_by_name':
          result = await this.findDevicesByName(args);
          break;
        case 'find_device_by_endpoint':
          result = await this.findDeviceByEndpoint(args);
          break;
        case 'get_device_property':
          result = await this.getDeviceProperty(args);
          break;
        case 'cancel_delayed_action':
          result = await this.cancelDelayedAction(args);
          break;
        case 'control_device':
          result = await this.controlDevice(args);
          break;
        case 'modify_device':
          result = await this.modifyDevice(args);
          break;

        // Room Management
        case 'get_room':
          result = await this.getRoom(args);
          break;
        case 'create_room':
          result = await this.createRoom(args);
          break;
        case 'modify_room':
          result = await this.modifyRoom(args);
          break;
        case 'delete_room':
          result = await this.deleteRoom(args);
          break;
        case 'assign_devices_to_room':
          result = await this.assignDevicesToRoom(args);
          break;
        case 'get_rooms':
          result = await this.getRooms();
          break;

        // Scene Management
        case 'get_scenes':
          result = await this.getScenes(args);
          break;
        case 'run_scene':
          result = await this.runScene(args);
          break;
        case 'stop_scene':
          result = await this.stopScene(args);
          break;
        case 'run_scene_sync':
          result = await this.runSceneSync(args);
          break;
        case 'modify_scene':
          result = await this.modifyScene(args);
          break;
        case 'create_scene':
          result = await this.createScene(args);
          break;
        case 'update_scene_content':
          result = await this.updateSceneContent(args);
          break;

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

        // Global Variables
        case 'get_global_variables':
          result = await this.getGlobalVariables();
          break;
        case 'create_global_variable':
          result = await this.createGlobalVariable(args);
          break;
        case 'set_global_variable':
          result = await this.setGlobalVariable(args);
          break;

        // User Management
        case 'get_users':
          result = await this.getUsers();
          break;
        case 'update_user_rights':
          result = await this.updateUserRights(args);
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
        case 'get_profiles':
          result = await this.getProfiles();
          break;
        case 'get_profile':
          result = await this.getProfile(args);
          break;
        case 'activate_profile':
          result = await this.activateProfile(args);
          break;
        case 'modify_profile':
          result = await this.modifyProfile(args);
          break;
        case 'create_profile':
          result = await this.createProfile(args);
          break;
        case 'delete_profile':
          result = await this.deleteProfile(args);
          break;
        case 'reset_profiles':
          result = await this.resetProfiles(args);
          break;
        case 'set_profile_scene_action':
          result = await this.setProfileSceneAction(args);
          break;
        case 'set_profile_climate_zone_action':
          result = await this.setProfileClimateZoneAction(args);
          break;
        case 'set_profile_partition_action':
          result = await this.setProfilePartitionAction(args);
          break;
        case 'set_home_status':
          result = await this.setHomeStatus(args);
          break;

        // Climate Management
        case 'get_climate_zones':
          result = await this.getClimateZones(args);
          break;
        case 'get_climate_zone':
          result = await this.getClimateZone(args);
          break;
        case 'update_climate_zone':
          result = await this.updateClimateZone(args);
          break;

        // Alarm System Management
        case 'get_alarm_partitions':
          result = await this.getAlarmPartitions();
          break;
        case 'get_alarm_partition':
          result = await this.getAlarmPartition(args);
          break;
        case 'arm_alarm_partition':
          result = await this.armAlarmPartition(args);
          break;
        case 'disarm_alarm_partition':
          result = await this.disarmAlarmPartition(args);
          break;
        case 'get_alarm_history':
          result = await this.getAlarmHistory(args);
          break;
        case 'get_alarm_devices':
          result = await this.getAlarmDevices(args);
          break;

        // Sprinkler System Management
        case 'get_sprinkler_systems':
          result = await this.getSprinklerSystems();
          break;
        case 'get_sprinkler_system':
          result = await this.getSprinklerSystem(args);
          break;
        case 'control_sprinkler_system':
          result = await this.controlSprinklerSystem(args);
          break;

        // Custom Events Management
        case 'get_custom_events':
          result = await this.getCustomEvents();
          break;
        case 'create_custom_event':
          result = await this.createCustomEvent(args);
          break;
        case 'get_custom_event':
          result = await this.getCustomEvent(args);
          break;
        case 'update_custom_event':
          result = await this.updateCustomEvent(args);
          break;
        case 'delete_custom_event':
          result = await this.deleteCustomEvent(args);
          break;
        case 'trigger_custom_event':
          result = await this.triggerCustomEvent(args);
          break;

        // Location Management
        case 'get_location_info':
          result = await this.getLocationInfo();
          break;
        case 'update_location_settings':
          result = await this.updateLocationSettings(args);
          break;

        // Notifications Management
        case 'get_notifications':
          result = await this.getNotifications(args);
          break;
        case 'mark_notification_read':
          result = await this.markNotificationRead(args);
          break;
        case 'get_notification':
          result = await this.getNotification(args);
          break;
        case 'update_notification':
          result = await this.updateNotification(args);
          break;
        case 'delete_notification':
          result = await this.deleteNotification(args);
          break;
        case 'clear_all_notifications':
          result = await this.clearAllNotifications();
          break;

        // Backup Management
        case 'can_create_backup':
          result = await this.canCreateBackup();
          break;
        case 'get_local_backup_status':
          result = await this.getLocalBackupStatus();
          break;
        case 'get_remote_backup_status':
          result = await this.getRemoteBackupStatus();
          break;
        case 'get_backups':
          result = await this.getBackups(args);
          break;
        case 'create_backup':
          result = await this.createBackup(args);
          break;

        // Debug Messages
        case 'clear_debug_messages':
          result = await this.clearDebugMessages();
          break;
        case 'get_debug_messages':
          result = await this.getDebugMessages(args);
          break;

        // iOS Devices Management
        case 'get_ios_devices':
          result = await this.getIosDevices();
          break;
        case 'register_ios_device':
          result = await this.registerIosDevice(args);
          break;

        // QuickApp Management
        case 'get_quickapps':
          result = await this.getQuickApps();
          break;
        case 'get_quickapp':
          result = await this.getQuickApp(args);
          break;
        case 'restart_quickapp':
          result = await this.restartQuickApp(args);
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

        // QuickApp file manipulation
        case 'list_quickapp_files':
          result = await this.listQuickAppFiles(args);
          break;
        case 'get_quickapp_file':
          result = await this.getQuickAppFile(args);
          break;
        case 'create_quickapp_file':
          result = await this.createQuickAppFile(args);
          break;
        case 'update_quickapp_file':
          result = await this.updateQuickAppFile(args);
          break;
        case 'update_multiple_quickapp_files':
          result = await this.updateMultipleQuickAppFiles(args);
          break;
        case 'get_quickapp_variable':
          result = await this.getQuickAppVariable(args);
          break;
        case 'set_quickapp_variable':
          result = await this.setQuickAppVariable(args);
          break;
        case 'delete_quickapp_file':
          result = await this.deleteQuickAppFile(args);
          break;
        case 'export_quickapp':
          result = await this.exportQuickApp(args);
          break;
        case 'create_quickapp':
          result = await this.createQuickApp(args);
          break;
        case 'get_quickapp_available_types':
          result = await this.getQuickAppAvailableTypes();
          break;
        case 'import_quickapp':
          result = await this.importQuickApp(args);
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
        case 'delete_device':
          result = await this.deleteDevice(args);
          break;
        case 'delete_global_variable':
          result = await this.deleteGlobalVariable(args);
          break;
        case 'delete_plugin':
          result = await this.deletePlugin(args);
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

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

  private async makeApiRequest(endpoint: string, method = 'GET', data?: any): Promise<any> {
    if (!this.config.host || !this.config.username || !this.config.password) {
      throw new Error('Fibaro HC3 not configured. Please check environment variables.');
    }

    const url = `http://${this.config.host}:${this.config.port}${endpoint}`;
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');

    const headers: Record<string, string> = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    };

    const requestOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(15000),
    };

    if (data && method !== 'GET') {
      requestOptions.body = JSON.stringify(data);
    }

    const response = await fetch(url, requestOptions);
    const text = await response.text();

    if (!response.ok) {
      const detail = text.trim();
      const suffix = detail ? ` - ${detail}` : '';
      throw new Error(`HTTP ${response.status}: ${response.statusText}${suffix}`);
    }

    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text);

    // HC3 action endpoints return HTTP 202 with a JSON-RPC envelope
    // ({jsonrpc, id, error, result, ...}). A non-null `error` means the
    // request was accepted but failed — "not implemented" etc. Without
    // this check, those failures masquerade as success.
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'jsonrpc' in parsed &&
      parsed.error !== null &&
      parsed.error !== undefined &&
      typeof parsed.error === 'object'
    ) {
      const code = (parsed.error as any).code;
      const msg = (parsed.error as any).message ?? JSON.stringify(parsed.error);
      throw new Error(`HC3 action failed for ${method} ${endpoint} (code ${code}): ${msg}`);
    }

    return parsed;
  }

  // Device Management Methods
  private async getDevices(args: { roomId?: number; deviceType?: string; interface?: string[] }): Promise<any> {
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

    return await this.makeApiRequest(endpoint);
  }

  private async getDeviceInfo(args: { deviceId: number }): Promise<any> {
    return await this.makeApiRequest(`/api/devices/${args.deviceId}`);
  }

  private async cancelDelayedAction(args: { deviceId: number; timestamp: number }): Promise<any> {
    if (typeof args?.deviceId !== 'number') throw new Error('cancel_delayed_action requires numeric deviceId.');
    if (typeof args?.timestamp !== 'number') throw new Error('cancel_delayed_action requires numeric timestamp.');
    const ts = Math.trunc(args.timestamp);
    await this.makeApiRequest(`/api/devices/action/${ts}/${args.deviceId}`, 'DELETE');
    return { cancelled: true, deviceId: args.deviceId, timestamp: ts };
  }

  private async getDeviceProperty(args: { deviceId: number; propertyName: string }): Promise<any> {
    if (typeof args?.deviceId !== 'number') throw new Error('get_device_property requires numeric deviceId.');
    if (typeof args?.propertyName !== 'string' || args.propertyName.length === 0) {
      throw new Error('get_device_property requires a non-empty propertyName.');
    }
    return await this.makeApiRequest(`/api/devices/${args.deviceId}/properties/${encodeURIComponent(args.propertyName)}`);
  }

  private async findDeviceByEndpoint(args: {
    parentId: number;
    endpointId: number;
  }): Promise<any> {
    if (typeof args?.parentId !== 'number' || typeof args?.endpointId !== 'number') {
      throw new Error('find_device_by_endpoint requires numeric parentId and endpointId.');
    }
    const children: any[] = await this.makeApiRequest(`/api/devices?parentId=${args.parentId}`);
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
  }

  private async filterDevices(args: {
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
    return await this.makeApiRequest('/api/devices/filter', 'POST', body);
  }

  private async findDevicesByName(args: {
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
    const devices: any[] = await this.makeApiRequest(endpoint);

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
  }

  private async controlDevice(args: { deviceId: number; action: string; args?: any[]; delay?: number }): Promise<any> {
    if (args.action === 'setVariable') {
      throw new Error(
        "control_device does not accept action 'setVariable' — the underlying POST /api/devices/{id}/action/setVariable " +
        "endpoint coerces numeric-looking string values (e.g. '3.0') to numbers while leaving the variable's declared " +
        "type as 'string', which breaks the HC3 web UI (the edit affordance disappears for that row). Use " +
        "set_quickapp_variable instead — it reads the declared type, coerces the value to match, and writes via the " +
        "documented PUT /api/devices/{id} endpoint with post-write verification."
      );
    }
    const device = await this.makeApiRequest(`/api/devices/${args.deviceId}`);
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

    await this.makeApiRequest(endpoint, 'POST', requestData);
    return `Device ${args.deviceId} action '${args.action}' executed successfully.`;
  }

  private async modifyDevice(args: {
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
        "modify_device does not accept properties.parameters — on HC3 firmware 5.x the PUT updates HC3's cached copy of the Z-wave configuration, but the physical device does not reliably pick up the new value. In direct testing against a Zooz ZEN52 the cache updated and HC3 reported success, but the device's behaviour did not change. HC3 5.x has no working REST path to verify whether a given write transmitted, and the dedicated action endpoints (getParameter / setParameter / reconfigure) return 'not implemented' on this firmware. Treat writes via this path as unreliable. Set Z-wave configuration parameters via the HC3 Web UI (which uses a native protocol) until a verifiable REST path is available. To inspect what HC3 has currently stored for this device's parameters (with labels, descriptions, defaults, and format), call get_device_parameters(deviceId)."
      );
    }

    if (properties && ('associations' in properties || 'multichannelAssociations' in properties)) {
      throw new Error(
        "modify_device does not accept properties.associations or properties.multichannelAssociations — precautionary reject based on the S14 finding (properties.parameters on the same firmware caches without transmitting, and every dedicated Z-wave action endpoint tested returns 'not implemented'). These mesh-management fields are structurally the same 'write-to-HC3, expected-to-push-downstream' pattern and are assumed to share the silent cache trap until proven otherwise. Set associations via the HC3 Web UI until a transmitting REST path is verified."
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

    await this.makeApiRequest(`/api/devices/${deviceId}`, 'PUT', body);
    const after = await this.makeApiRequest(`/api/devices/${deviceId}`);
    this.verifyWrite(topLevel, properties, after, `device ${deviceId}`);

    const submittedSummary: Record<string, any> = {};
    if (topLevelKeys.length > 0) submittedSummary.topLevel = topLevel;
    if (propertiesKeys.length > 0) submittedSummary.properties = properties;
    return {
      deviceId,
      submitted: submittedSummary,
      verified: true
    };
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      return a.every((v, i) => this.deepEqual(v, b[i]));
    }
    if (typeof a === 'object') {
      const keys = Object.keys(a);
      return keys.every(k => this.deepEqual(a[k], b[k]));
    }
    return false;
  }

  private deepMerge(base: any, overlay: any): any {
    if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) {
      return overlay;
    }
    if (base === null || typeof base !== 'object' || Array.isArray(base)) {
      return { ...overlay };
    }
    const result: Record<string, any> = { ...base };
    for (const key of Object.keys(overlay)) {
      const submittedVal = overlay[key];
      const baseVal = base[key];
      if (
        submittedVal !== null &&
        typeof submittedVal === 'object' &&
        !Array.isArray(submittedVal) &&
        baseVal !== null &&
        typeof baseVal === 'object' &&
        !Array.isArray(baseVal)
      ) {
        result[key] = this.deepMerge(baseVal, submittedVal);
      } else {
        result[key] = submittedVal;
      }
    }
    return result;
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
    const subsetMatch = (submitted: any, stored: any): boolean => {
      if (submitted === null || typeof submitted !== 'object' || Array.isArray(submitted)) {
        return this.deepEqual(submitted, stored);
      }
      if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
        return false;
      }
      return Object.keys(submitted).every(k => this.deepEqual(submitted[k], stored[k]));
    };

    const fmt = (v: any) =>
      v === undefined ? 'undefined' :
      typeof v === 'string' ? JSON.stringify(v) :
      (typeof v === 'object' ? JSON.stringify(v) : String(v));

    const mismatches: string[] = [];
    const afterProps = after?.properties ?? {};
    const topLevelKeys = topLevel ? Object.keys(topLevel) : [];
    const propertiesKeys = properties ? Object.keys(properties) : [];

    for (const key of topLevelKeys) {
      const submitted = (topLevel as any)[key];
      const stored = after?.[key];
      const match = Array.isArray(submitted)
        ? this.deepEqual(submitted, stored)
        : (submitted !== null && typeof submitted === 'object'
            ? subsetMatch(submitted, stored)
            : submitted === stored);
      if (!match) {
        let line = `  - topLevel.${key}: submitted ${fmt(submitted)}, stored ${fmt(stored)}`;
        if (stored === undefined && afterProps[key] !== undefined) {
          line += ` (did you mean to put '${key}' in properties?)`;
        }
        mismatches.push(line);
      }
    }

    for (const key of propertiesKeys) {
      const submitted = (properties as any)[key];
      const stored = afterProps[key];
      const match = Array.isArray(submitted)
        ? this.deepEqual(submitted, stored)
        : (submitted !== null && typeof submitted === 'object'
            ? subsetMatch(submitted, stored)
            : submitted === stored);
      if (!match) {
        let line = `  - properties.${key}: submitted ${fmt(submitted)}, stored ${fmt(stored)}`;
        if (stored === undefined && after?.[key] !== undefined) {
          line += ` (did you mean to put '${key}' in topLevel?)`;
        }
        mismatches.push(line);
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        `Post-write verification failed for ${entityLabel}.\n` +
        `Mismatched fields:\n${mismatches.join('\n')}\n` +
        `Likely causes: HC3 silently dropped the field (verify field name and location), ` +
        `HC3 normalised the value (resubmit with HC3's representation), or the field is ` +
        `under the wrong wrapper (top-level vs properties).`
      );
    }
  }

  // Room Management Methods
  private async getRooms(): Promise<any> {
    return await this.makeApiRequest('/api/rooms');
  }

  private async getRoom(args: { roomId: number }): Promise<any> {
    if (typeof args?.roomId !== 'number') throw new Error('get_room requires numeric roomId.');
    return await this.makeApiRequest(`/api/rooms/${args.roomId}`);
  }

  private async createRoom(args: {
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
    const created: any = await this.makeApiRequest('/api/rooms', 'POST', body);
    const newId = created?.id;
    if (typeof newId !== 'number') {
      throw new Error(`create_room: HC3 returned no id. Raw: ${JSON.stringify(created).slice(0, 300)}`);
    }
    const after: any = await this.makeApiRequest(`/api/rooms/${newId}`);
    if (after?.name !== args.name) {
      throw new Error(`create_room: post-create name mismatch. Submitted ${JSON.stringify(args.name)}, stored ${JSON.stringify(after?.name)}.`);
    }
    return { roomId: newId, room: after };
  }

  private async modifyRoom(args: {
    roomId: number;
    fields: Record<string, any>;
  }): Promise<any> {
    if (typeof args?.roomId !== 'number') throw new Error('modify_room requires numeric roomId.');
    if (!args?.fields || typeof args.fields !== 'object' || Array.isArray(args.fields) || Object.keys(args.fields).length === 0) {
      throw new Error('modify_room requires a non-empty fields object.');
    }
    const current: any = await this.makeApiRequest(`/api/rooms/${args.roomId}`);
    const merged = this.deepMerge(current, args.fields);
    await this.makeApiRequest(`/api/rooms/${args.roomId}`, 'PUT', merged);
    const after: any = await this.makeApiRequest(`/api/rooms/${args.roomId}`);
    this.verifyWrite(args.fields, undefined, after, `room ${args.roomId}`);
    return { roomId: args.roomId, changedFields: Object.keys(args.fields), room: after };
  }

  private async deleteRoom(args: { roomId: number; reassign_to?: number }): Promise<any> {
    if (typeof args?.roomId !== 'number') throw new Error('delete_room requires numeric roomId.');
    const room: any = await this.makeApiRequest(`/api/rooms/${args.roomId}`);
    if (room?.isDefault) {
      throw new Error(`delete_room refuses room ${args.roomId} (${room.name}): it is the default room and cannot be deleted.`);
    }
    const devices: any[] = await this.makeApiRequest(`/api/devices?roomID=${args.roomId}`);
    if (devices.length > 0) {
      if (typeof args.reassign_to !== 'number') {
        throw new Error(
          `delete_room refuses room ${args.roomId} (${room.name}): has ${devices.length} devices. ` +
          `Pass reassign_to=<targetRoomId> to batch-move them first, or move them manually.`
        );
      }
      await this.makeApiRequest(`/api/rooms/${args.reassign_to}/groupAssignment`, 'POST', {
        deviceIds: devices.map(d => d.id)
      });
    }
    await this.makeApiRequest(`/api/rooms/${args.roomId}`, 'DELETE');
    try {
      await this.makeApiRequest(`/api/rooms/${args.roomId}`);
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
  }

  private async assignDevicesToRoom(args: {
    roomId: number;
    deviceIds: number[];
  }): Promise<any> {
    if (typeof args?.roomId !== 'number') throw new Error('assign_devices_to_room requires numeric roomId.');
    if (!Array.isArray(args?.deviceIds) || args.deviceIds.length === 0) {
      throw new Error('assign_devices_to_room requires a non-empty deviceIds array.');
    }
    await this.makeApiRequest(`/api/rooms/${args.roomId}/groupAssignment`, 'POST', {
      deviceIds: args.deviceIds
    });
    const mismatches: Array<{ deviceId: number; reportedRoom: number }> = [];
    await Promise.all(args.deviceIds.map(async id => {
      try {
        const d: any = await this.makeApiRequest(`/api/devices/${id}`);
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
  }

  // Scene Management Methods
  private async getScenes(args: { roomId?: number; alexaProhibited?: boolean }): Promise<any> {
    let endpoint = '/api/scenes';
    const queryParams: string[] = [];

    if (args?.alexaProhibited !== undefined) {
      queryParams.push(`alexaProhibited=${args.alexaProhibited}`);
    }

    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    const scenes = await this.makeApiRequest(endpoint);
    
    if (args?.roomId) {
      return scenes.filter((scene: any) => scene.roomID === args.roomId);
    }

    return scenes;
  }

  private async runScene(args: { sceneId: number }): Promise<any> {
    await this.makeApiRequest(`/api/scenes/${args.sceneId}/execute`, 'POST', {});
    return `Scene ${args.sceneId} started successfully.`;
  }

  private async stopScene(args: { sceneId: number }): Promise<any> {
    await this.makeApiRequest(`/api/scenes/${args.sceneId}/kill`, 'POST', {});
    return `Scene ${args.sceneId} stopped successfully.`;
  }

  private async runSceneSync(args: { sceneId: number }): Promise<any> {
    if (typeof args?.sceneId !== 'number') {
      throw new Error('run_scene_sync requires numeric sceneId.');
    }
    const started = Date.now();
    await this.makeApiRequest(`/api/scenes/${args.sceneId}/executeSync`, 'POST', {});
    return {
      sceneId: args.sceneId,
      mode: 'sync',
      elapsedMs: Date.now() - started
    };
  }

  private async modifyScene(args: { sceneId: number; properties: Record<string, any> }): Promise<any> {
    if (!args?.properties || Object.keys(args.properties).length === 0) {
      throw new Error('modify_scene requires at least one field in properties.');
    }
    await this.makeApiRequest(`/api/scenes/${args.sceneId}`, 'PUT', args.properties);
    const updated = await this.makeApiRequest(`/api/scenes/${args.sceneId}`);
    this.verifyWrite(args.properties, undefined, updated, `scene ${args.sceneId}`);
    return {
      sceneId: args.sceneId,
      changedFields: Object.keys(args.properties),
      scene: updated,
    };
  }

  private async createScene(args: {
    name: string;
    type: string;
    roomId?: number;
    content?: any;
    maxRunningInstances?: number;
    enabled?: boolean;
    hidden?: boolean;
    icon?: string;
    categories?: number[];
  }): Promise<any> {
    if (!args?.name) throw new Error('create_scene requires name.');
    if (args.name.length < 1 || args.name.length > 50) {
      throw new Error(`create_scene: name must be 1–50 characters (got ${args.name.length}).`);
    }
    if (args.type !== 'lua' && args.type !== 'scenario') {
      throw new Error(`create_scene: type must be "lua" or "scenario" (got ${JSON.stringify(args.type)}).`);
    }
    if (typeof args.roomId !== 'number') {
      throw new Error('create_scene: roomId is required and must be a valid room id (HC3 rejects roomId=0 on creation).');
    }
    const body: Record<string, any> = {
      name: args.name,
      type: args.type,
      mode: 'automatic',
      roomId: args.roomId,
      maxRunningInstances: args.maxRunningInstances ?? 1,
      enabled: args.enabled !== false,
      hidden: !!args.hidden,
      icon: args.icon ?? 'scene_icon_icon_scene1',
      restart: true,
      protectedByPin: false,
      stopOnAlarm: false,
      categories: args.categories && args.categories.length > 0 ? args.categories : [1]
    };
    if (args.content !== undefined) {
      body.content = typeof args.content === 'string' ? args.content : JSON.stringify(args.content);
    }
    const created: any = await this.makeApiRequest('/api/scenes', 'POST', body);
    const newId = created?.id;
    if (typeof newId !== 'number') {
      throw new Error(`create_scene: HC3 returned no id. Raw: ${JSON.stringify(created).slice(0, 300)}`);
    }
    const after: any = await this.makeApiRequest(`/api/scenes/${newId}`);
    if (after?.name !== args.name) {
      throw new Error(`create_scene: post-create name mismatch. Submitted ${JSON.stringify(args.name)}, stored ${JSON.stringify(after?.name)}.`);
    }
    if (after?.type !== args.type) {
      throw new Error(`create_scene: post-create type mismatch. Submitted ${JSON.stringify(args.type)}, stored ${JSON.stringify(after?.type)}.`);
    }
    return { sceneId: newId, scene: after };
  }

  private async updateSceneContent(args: { sceneId: number; actions?: string; conditions?: string }): Promise<any> {
    if (args.actions === undefined && args.conditions === undefined) {
      throw new Error('update_scene_content requires at least one of actions or conditions.');
    }

    const existing = await this.makeApiRequest(`/api/scenes/${args.sceneId}`);

    if (existing.type !== 'lua') {
      throw new Error(
        `Scene ${args.sceneId} is type '${existing.type}'; this tool supports Lua scenes only. ` +
        `Scenario scenes use structured JSON for conditions and would be corrupted by this tool.`
      );
    }

    let previous: { conditions: string; actions: string } = { conditions: '', actions: '' };
    try {
      const parsed = JSON.parse(existing.content || '{}');
      previous = {
        conditions: typeof parsed.conditions === 'string' ? parsed.conditions : '',
        actions: typeof parsed.actions === 'string' ? parsed.actions : '',
      };
    } catch {
      // leave previous as empty defaults
    }

    const newContent = {
      conditions: args.conditions !== undefined ? args.conditions : previous.conditions,
      actions: args.actions !== undefined ? args.actions : previous.actions,
    };

    await this.makeApiRequest(`/api/scenes/${args.sceneId}`, 'PUT', { content: JSON.stringify(newContent) });
    const updated = await this.makeApiRequest(`/api/scenes/${args.sceneId}`);

    let current: { conditions: string; actions: string } = { conditions: '', actions: '' };
    try {
      const parsed = JSON.parse(updated.content || '{}');
      current = {
        conditions: typeof parsed.conditions === 'string' ? parsed.conditions : '',
        actions: typeof parsed.actions === 'string' ? parsed.actions : '',
      };
    } catch {
      // leave current as empty defaults
    }

    const changedFields: string[] = [];
    if (args.conditions !== undefined) changedFields.push('conditions');
    if (args.actions !== undefined) changedFields.push('actions');

    return {
      sceneId: args.sceneId,
      changedFields,
      previous,
      current,
      scene: updated,
    };
  }

  // System Information Methods
  private async getSystemInfo(): Promise<any> {
    return await this.makeApiRequest('/api/settings/info');
  }

  private async getNetworkStatus(): Promise<any> {
    return await this.makeApiRequest('/api/settings/network');
  }

  // Energy Management Methods
  private async getEnergyData(args: { deviceId?: number }): Promise<any> {
    if (args?.deviceId) {
      return await this.makeApiRequest(`/api/energy/${args.deviceId}`);
    } else {
      return await this.makeApiRequest('/api/energy');
    }
  }

  // Global Variables Methods
  private async getGlobalVariables(): Promise<any> {
    return await this.makeApiRequest('/api/globalVariables');
  }

  private async createGlobalVariable(args: {
    varName: string;
    value: any;
    readOnly?: boolean;
    isEnum?: boolean;
    enumValues?: string[];
  }): Promise<any> {
    if (typeof args?.varName !== 'string' || args.varName.length === 0) {
      throw new Error('create_global_variable requires a non-empty varName.');
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(args.varName)) {
      throw new Error(
        `create_global_variable: varName ${JSON.stringify(args.varName)} does not match HC3's required format [A-Za-z][A-Za-z0-9_]* (must start with a letter; letters, digits, and underscores only).`
      );
    }
    if (args.isEnum) {
      if (!Array.isArray(args.enumValues) || args.enumValues.length === 0) {
        throw new Error('create_global_variable: isEnum=true requires a non-empty enumValues array.');
      }
      const candidate = String(args.value);
      if (!args.enumValues.includes(candidate)) {
        throw new Error(
          `create_global_variable: initial value ${JSON.stringify(args.value)} is not in enumValues ${JSON.stringify(args.enumValues)} (case-sensitive).`
        );
      }
    }

    const encoded = encodeURIComponent(args.varName);
    try {
      await this.makeApiRequest(`/api/globalVariables/${encoded}`);
      throw new Error(
        `create_global_variable refuses to overwrite: variable '${args.varName}' already exists. Use set_global_variable to update, or delete_global_variable first.`
      );
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (!/404|not.?found/i.test(msg) && !msg.startsWith('create_global_variable refuses')) {
        throw e;
      }
      if (msg.startsWith('create_global_variable refuses')) throw e;
    }

    const body: Record<string, any> = { name: args.varName, value: args.value };
    if (args.readOnly !== undefined) body.readOnly = args.readOnly;
    if (args.isEnum) {
      body.isEnum = true;
      body.enumValues = args.enumValues;
    }

    const created: any = await this.makeApiRequest('/api/globalVariables', 'POST', body);

    const after: any = await this.makeApiRequest(`/api/globalVariables/${encoded}`);
    if (String(after?.value) !== String(args.value)) {
      throw new Error(
        `create_global_variable: post-create value mismatch for '${args.varName}'. Submitted ${JSON.stringify(args.value)}, stored ${JSON.stringify(after?.value)}.`
      );
    }
    return {
      created: args.varName,
      value: after?.value,
      isEnum: !!after?.isEnum,
      enumValues: after?.enumValues,
      readOnly: !!after?.readOnly,
      raw: created
    };
  }

  private async setGlobalVariable(args: { varName: string; value: any }): Promise<any> {
    const encoded = encodeURIComponent(args.varName);
    const existing: any = await this.makeApiRequest(`/api/globalVariables/${encoded}`);

    if (existing?.readOnly) {
      throw new Error(
        `Global variable '${args.varName}' is read-only (HC3 system variable) and cannot be set via this tool.`
      );
    }

    let coerced: any;
    if (existing?.isEnum) {
      const enumValues: string[] = Array.isArray(existing.enumValues) ? existing.enumValues : [];
      const candidate = String(args.value);
      if (!enumValues.includes(candidate)) {
        throw new Error(
          `Global variable '${args.varName}' is an enum with values [${enumValues.map(v => `'${v}'`).join(', ')}]. ` +
          `Submitted value ${JSON.stringify(args.value)} is not in the set (match is case-sensitive).`
        );
      }
      coerced = candidate;
    } else {
      const storedType = typeof existing?.value;
      if (storedType === 'number') {
        const n = typeof args.value === 'number' ? args.value : Number(args.value);
        if (!Number.isFinite(n)) {
          throw new Error(
            `Global variable '${args.varName}' is numeric; submitted value ${JSON.stringify(args.value)} is not a number.`
          );
        }
        coerced = n;
      } else if (storedType === 'boolean') {
        if (typeof args.value === 'boolean') coerced = args.value;
        else if (args.value === 'true' || args.value === 1) coerced = true;
        else if (args.value === 'false' || args.value === 0) coerced = false;
        else {
          throw new Error(
            `Global variable '${args.varName}' is boolean; submitted value ${JSON.stringify(args.value)} cannot be coerced to boolean.`
          );
        }
      } else {
        coerced = typeof args.value === 'string' ? args.value : String(args.value);
      }
    }

    await this.makeApiRequest(`/api/globalVariables/${encoded}`, 'PUT', { value: coerced });

    const after: any = await this.makeApiRequest(`/api/globalVariables/${encoded}`);
    if (String(after?.value) !== String(coerced)) {
      throw new Error(
        `Post-write verification failed for global variable '${args.varName}': ` +
        `submitted ${JSON.stringify(coerced)}, HC3 stored ${JSON.stringify(after?.value)}.`
      );
    }

    return {
      name: args.varName,
      previous: { value: existing?.value, isEnum: !!existing?.isEnum },
      current: { value: after?.value, isEnum: !!after?.isEnum }
    };
  }

  // User Management Methods
  private async getUsers(): Promise<any> {
    return await this.makeApiRequest('/api/users');
  }

  private async updateUserRights(args: {
    userId: number;
    rights: Record<string, any>;
    allow_advanced_rights?: boolean;
    allow_grant_all?: boolean;
  }): Promise<any> {
    if (typeof args?.userId !== 'number') {
      throw new Error('update_user_rights requires a numeric userId.');
    }
    if (!args?.rights || typeof args.rights !== 'object' || Array.isArray(args.rights) || Object.keys(args.rights).length === 0) {
      throw new Error('update_user_rights requires a non-empty rights object.');
    }

    if ('advanced' in args.rights && !args.allow_advanced_rights) {
      const advancedKeys = Object.keys(args.rights.advanced || {});
      throw new Error(
        `update_user_rights: writing rights.advanced is a privilege-escalation footgun. ` +
        `Submitted advanced keys: [${advancedKeys.join(', ')}]. ` +
        `Pass allow_advanced_rights=true to override.`
      );
    }

    const grantAllOffences: string[] = [];
    for (const [category, val] of Object.entries(args.rights)) {
      if (val && typeof val === 'object' && !Array.isArray(val) && (val as any).all === true) {
        grantAllOffences.push(`rights.${category}.all=true`);
      }
    }
    if (grantAllOffences.length > 0 && !args.allow_grant_all) {
      throw new Error(
        `update_user_rights: mass-grant write rejected — ${grantAllOffences.join(', ')}. ` +
        `Pass allow_grant_all=true to override.`
      );
    }

    const current: any = await this.makeApiRequest(`/api/users/${args.userId}`);
    if (current?.type === 'superuser') {
      throw new Error(
        `update_user_rights: user ${args.userId} (${current.name}) is type 'superuser' — ` +
        `rights are all-true by design. Any state change here could break admin access. Refusing.`
      );
    }

    const currentRights = (current?.rights && typeof current.rights === 'object') ? current.rights : {};
    const mergedRights = this.deepMerge(currentRights, args.rights);

    // PUT only {rights: ...}, not the full user record. HC3 rejects writes
    // to tosAccepted / privacyPolicyAccepted by anyone other than the user
    // themselves, so a full-record echo-back will 403 with "Terms of service
    // acceptance change forbidden". Partial PUT of just rights is accepted.
    await this.makeApiRequest(`/api/users/${args.userId}`, 'PUT', { rights: mergedRights });

    const after: any = await this.makeApiRequest(`/api/users/${args.userId}`);
    const afterRights = after?.rights ?? {};

    const mismatches: string[] = [];
    for (const [category, submittedCat] of Object.entries(args.rights)) {
      if (submittedCat === null || typeof submittedCat !== 'object' || Array.isArray(submittedCat)) continue;
      const storedCat = afterRights[category] ?? {};
      for (const [leafKey, submittedLeaf] of Object.entries(submittedCat)) {
        const storedLeaf = storedCat[leafKey];
        if (Array.isArray(submittedLeaf)) {
          const storedArr = Array.isArray(storedLeaf) ? storedLeaf : [];
          const missing = submittedLeaf.filter(v => !storedArr.includes(v));
          const extra = storedArr.filter(v => !submittedLeaf.includes(v));
          if (missing.length > 0 || extra.length > 0) {
            mismatches.push(
              `  - rights.${category}.${leafKey}: submitted ${JSON.stringify(submittedLeaf)}, stored ${JSON.stringify(storedLeaf)}`
            );
          }
        } else if (!this.deepEqual(submittedLeaf, storedLeaf)) {
          mismatches.push(
            `  - rights.${category}.${leafKey}: submitted ${JSON.stringify(submittedLeaf)}, stored ${JSON.stringify(storedLeaf)}`
          );
        }
      }
    }
    if (mismatches.length > 0) {
      throw new Error(
        `Post-write verification failed for user ${args.userId} (${current.name}).\nMismatched fields:\n${mismatches.join('\n')}\n` +
        `HC3 did not persist the submitted rights as expected.`
      );
    }

    return {
      userId: args.userId,
      name: current.name,
      changedCategories: Object.keys(args.rights),
      rights: afterRights
    };
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
          this.makeApiRequest(simple[name])
            .then((v: any) => { surfaces[name] = v; })
            .catch((e: any) => { surfaceErrors[name] = String(e?.message ?? e); })
        );
        continue;
      }

      if (name === 'hc3-docs') {
        jobs.push((async () => {
          const docs: Record<string, any> = {};
          await Promise.allSettled([
            this.makeApiRequest('/assets/docs/hc/plugins.json')
              .then((v: any) => { docs['plugins.json'] = v; })
              .catch((e: any) => { surfaceErrors['hc3-docs.plugins.json'] = String(e?.message ?? e); }),
            this.makeApiRequest('/assets/docs/hc/quickapp.json')
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
            const qas: any[] = await this.makeApiRequest('/api/devices?interface=quickApp');
            const result: any[] = [];
            await Promise.allSettled(qas.map(async (qa: any) => {
              try {
                const fileList: any[] = await this.makeApiRequest(`/api/quickApp/${qa.id}/files`);
                const files = await Promise.allSettled(
                  (fileList ?? []).map(async f => {
                    try {
                      const content: any = await this.makeApiRequest(
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
            const devices: any[] = await this.makeApiRequest('/api/devices?interface=zwave');
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
                  const v: any = await this.makeApiRequest(
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
    return await this.makeApiRequest('/api/icons');
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
    const url = `http://${this.config.host}:${this.config.port}${path}`;
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
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
    if (!this.config.host || !this.config.username || !this.config.password) {
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

    const before: any = await this.makeApiRequest('/api/icons');
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

    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    const response = await fetch(`http://${this.config.host}:${this.config.port}/api/icons`, {
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
    const after: any = await this.makeApiRequest('/api/icons');
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

    const before: any = await this.makeApiRequest('/api/icons');
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
    await this.makeApiRequest(`/api/icons?${params.toString()}`, 'DELETE');

    const after: any = await this.makeApiRequest('/api/icons');
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
    return await this.makeApiRequest('/api/diagnostics');
  }

  private async getZwaveMeshHealth(): Promise<any> {
    const [devices, rooms] = await Promise.all([
      this.makeApiRequest('/api/devices?interface=zwave'),
      this.makeApiRequest('/api/rooms')
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
      this.makeApiRequest('/api/zwave/nodes/diagnostics/transmissions'),
      this.makeApiRequest('/api/devices?interface=zwave'),
      this.makeApiRequest('/api/rooms')
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
    const device: any = await this.makeApiRequest(`/api/devices/${deviceId}`);
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
      this.makeApiRequest(`/api/zwave/configuration_parameters/${encodedAddr}`)
        .catch((e: any) => ({ __error: String(e?.message ?? e) })),
      this.makeApiRequest(`/api/zwave/parameters_templates/${encodedAddr}`)
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
      this.makeApiRequest('/api/zwaveReconfigurationTasks'),
      this.makeApiRequest('/api/devices?interface=zwave'),
      this.makeApiRequest('/api/rooms')
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
    return await this.makeApiRequest(`/api/refreshStates?last=${last}&lang=en`);
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
    const events: any[] = await this.makeApiRequest(`/api/events/history?${params.toString()}`);
    if (sinceTimestamp !== undefined) {
      return events.filter(e => (e?.timestamp ?? 0) >= sinceTimestamp);
    }
    return events;
  }

  // Weather Methods
  private async getWeather(): Promise<any> {
    return await this.makeApiRequest('/api/weather');
  }

  // Home Status Methods
  private async getHomeStatus(): Promise<any> {
    return await this.makeApiRequest('/api/panels/location');
  }

  private async setHomeStatus(args: { status: string }): Promise<any> {
    const validModes = ['Home', 'Away', 'Night', 'Vacation'];
    if (!validModes.includes(args.status)) {
      throw new Error(`set_home_status: invalid status '${args.status}'. Must be one of: ${validModes.join(', ')}.`);
    }
    await this.makeApiRequest('/api/panels/location', 'PUT', { mode: args.status });
    return `Home status set to '${args.status}' successfully.`;
  }

  // Profile Methods
  private async getProfiles(): Promise<any> {
    return await this.makeApiRequest('/api/profiles');
  }

  private async getProfile(args: { profileId: number }): Promise<any> {
    if (typeof args?.profileId !== 'number') {
      throw new Error('get_profile requires numeric profileId.');
    }
    return await this.makeApiRequest(`/api/profiles/${args.profileId}`);
  }

  private async activateProfile(args: { profileId: number }): Promise<any> {
    if (typeof args?.profileId !== 'number') {
      throw new Error('activate_profile requires numeric profileId.');
    }
    const before: any = await this.makeApiRequest('/api/profiles');
    const profile = (before?.profiles ?? []).find((p: any) => p.id === args.profileId);
    if (!profile) {
      throw new Error(`activate_profile: profile ${args.profileId} not found.`);
    }
    await this.makeApiRequest(`/api/profiles/activeProfile/${args.profileId}`, 'POST', {});
    const after: any = await this.makeApiRequest('/api/profiles');
    if (after?.activeProfile !== args.profileId) {
      throw new Error(
        `activate_profile: post-activation verify failed. Submitted activeProfile=${args.profileId}, HC3 reports activeProfile=${after?.activeProfile}.`
      );
    }
    return {
      activated: args.profileId,
      name: profile.name,
      previousActive: before?.activeProfile
    };
  }

  private async modifyProfile(args: {
    profileId: number;
    fields: Record<string, any>;
  }): Promise<any> {
    if (typeof args?.profileId !== 'number') {
      throw new Error('modify_profile requires numeric profileId.');
    }
    if (!args?.fields || typeof args.fields !== 'object' || Array.isArray(args.fields) || Object.keys(args.fields).length === 0) {
      throw new Error('modify_profile requires a non-empty fields object.');
    }
    const current: any = await this.makeApiRequest(`/api/profiles/${args.profileId}`);
    const merged = this.deepMerge(current, args.fields);
    await this.makeApiRequest(`/api/profiles/${args.profileId}`, 'PUT', merged);
    const after: any = await this.makeApiRequest(`/api/profiles/${args.profileId}`);
    this.verifyWrite(args.fields, undefined, after, `profile ${args.profileId}`);
    return {
      profileId: args.profileId,
      changedFields: Object.keys(args.fields),
      profile: after
    };
  }

  private async createProfile(args: { name: string; iconId?: number }): Promise<any> {
    if (!args?.name) throw new Error('create_profile requires name.');
    const body: Record<string, any> = { name: args.name };
    if (args.iconId !== undefined) body.iconId = args.iconId;
    const created: any = await this.makeApiRequest('/api/profiles', 'POST', body);
    const newId = created?.id;
    if (typeof newId !== 'number') {
      throw new Error(`create_profile: HC3 returned no id. Raw: ${JSON.stringify(created).slice(0, 300)}`);
    }
    const after: any = await this.makeApiRequest(`/api/profiles/${newId}`);
    if (after?.name !== args.name) {
      throw new Error(`create_profile: post-create name mismatch. Submitted ${JSON.stringify(args.name)}, stored ${JSON.stringify(after?.name)}.`);
    }
    return { profileId: newId, profile: after };
  }

  private async deleteProfile(args: { profileId: number }): Promise<any> {
    if (typeof args?.profileId !== 'number') throw new Error('delete_profile requires numeric profileId.');
    const list: any = await this.makeApiRequest('/api/profiles');
    if (list?.activeProfile === args.profileId) {
      const name = (list.profiles ?? []).find((p: any) => p.id === args.profileId)?.name ?? '?';
      throw new Error(
        `delete_profile refuses profile ${args.profileId} (${name}): it is the currently active profile. ` +
        `Use activate_profile to switch first, then delete.`
      );
    }
    const existing = (list.profiles ?? []).find((p: any) => p.id === args.profileId);
    if (!existing) {
      throw new Error(`delete_profile: profile ${args.profileId} not found.`);
    }
    await this.makeApiRequest(`/api/profiles/${args.profileId}`, 'DELETE');
    try {
      await this.makeApiRequest(`/api/profiles/${args.profileId}`);
      throw new Error(`delete_profile: post-delete verify failed — profile ${args.profileId} still exists.`);
    } catch (e: any) {
      if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
    }
    return { deleted: args.profileId, name: existing.name };
  }

  private async resetProfiles(args: { confirm: boolean }): Promise<any> {
    if (args?.confirm !== true) {
      throw new Error(
        'reset_profiles refuses: this DESTROYS all custom profile configuration (device lists, scene actions, climate zone actions, partition actions) across every profile. Pass confirm=true to proceed. No undo.'
      );
    }
    await this.makeApiRequest('/api/profiles/reset', 'POST', null);
    return { reset: true, warning: 'All profiles reset to HC3 defaults. Custom configuration erased.' };
  }

  private async setProfileSceneAction(args: {
    profileId: number;
    sceneId: number;
    actions: string[];
  }): Promise<any> {
    if (typeof args?.profileId !== 'number') throw new Error('set_profile_scene_action requires numeric profileId.');
    if (typeof args?.sceneId !== 'number') throw new Error('set_profile_scene_action requires numeric sceneId.');
    if (!Array.isArray(args?.actions)) throw new Error('set_profile_scene_action requires actions array.');
    await this.makeApiRequest(
      `/api/profiles/${args.profileId}/scenes/${args.sceneId}`,
      'PUT',
      { actions: args.actions }
    );
    const after: any = await this.makeApiRequest(`/api/profiles/${args.profileId}`);
    const entry = (after?.scenes ?? []).find((s: any) => s.sceneId === args.sceneId);
    if (!entry) {
      throw new Error(
        `set_profile_scene_action: post-write verify — scene ${args.sceneId} not found in profile ${args.profileId} after PUT. ` +
        `The scene may need to be added to the profile's scenes array first via modify_profile.`
      );
    }
    if (!this.deepEqual(entry.actions, args.actions)) {
      throw new Error(
        `set_profile_scene_action: post-write verify failed. Submitted ${JSON.stringify(args.actions)}, stored ${JSON.stringify(entry.actions)}.`
      );
    }
    return { profileId: args.profileId, sceneId: args.sceneId, actions: entry.actions };
  }

  private async setProfileClimateZoneAction(args: {
    profileId: number;
    zoneId: number;
    mode: string;
    properties?: Record<string, any>;
  }): Promise<any> {
    if (typeof args?.profileId !== 'number') throw new Error('set_profile_climate_zone_action requires numeric profileId.');
    if (typeof args?.zoneId !== 'number') throw new Error('set_profile_climate_zone_action requires numeric zoneId.');
    if (typeof args?.mode !== 'string') throw new Error('set_profile_climate_zone_action requires mode.');
    const body: Record<string, any> = { mode: args.mode };
    if (args.properties !== undefined) body.properties = args.properties;
    await this.makeApiRequest(
      `/api/profiles/${args.profileId}/climateZones/${args.zoneId}`,
      'PUT',
      body
    );
    const after: any = await this.makeApiRequest(`/api/profiles/${args.profileId}`);
    const entry = (after?.climateZones ?? []).find((z: any) => z.id === args.zoneId);
    if (!entry || entry.mode !== args.mode) {
      throw new Error(
        `set_profile_climate_zone_action: post-write verify failed. ` +
        `Stored: ${JSON.stringify(entry ?? null)}. Submitted mode=${JSON.stringify(args.mode)}.`
      );
    }
    return { profileId: args.profileId, zoneId: args.zoneId, mode: entry.mode, properties: entry.properties };
  }

  private async setProfilePartitionAction(args: {
    profileId: number;
    partitionId: number;
    action: string | null;
  }): Promise<any> {
    if (typeof args?.profileId !== 'number') throw new Error('set_profile_partition_action requires numeric profileId.');
    if (typeof args?.partitionId !== 'number') throw new Error('set_profile_partition_action requires numeric partitionId.');
    await this.makeApiRequest(
      `/api/profiles/${args.profileId}/partitions/${args.partitionId}`,
      'PUT',
      { action: args.action ?? null }
    );
    const after: any = await this.makeApiRequest(`/api/profiles/${args.profileId}`);
    const entry = (after?.partitions ?? []).find((p: any) => p.id === args.partitionId);
    if (!entry) {
      throw new Error(
        `set_profile_partition_action: post-write verify — partition ${args.partitionId} not found in profile ${args.profileId}.`
      );
    }
    if (entry.action !== (args.action ?? null)) {
      throw new Error(
        `set_profile_partition_action: post-write verify failed. Submitted ${JSON.stringify(args.action)}, stored ${JSON.stringify(entry.action)}.`
      );
    }
    return { profileId: args.profileId, partitionId: args.partitionId, action: entry.action };
  }

  // Climate Management Methods
  private async getClimateZones(args: { detailed?: boolean }): Promise<any> {
    const detailed = args.detailed ? '?detailed=true' : '';
    return await this.makeApiRequest(`/api/panels/climate${detailed}`);
  }

  private async getClimateZone(args: { zoneId: number }): Promise<any> {
    return await this.makeApiRequest(`/api/panels/climate/${args.zoneId}`);
  }

  private async updateClimateZone(args: {
    zoneId: number;
    topLevel?: Record<string, any>;
    properties?: Record<string, any>;
  }): Promise<any> {
    const { zoneId, topLevel, properties } = args;

    const topLevelKeys = topLevel ? Object.keys(topLevel) : [];
    const propertiesKeys = properties ? Object.keys(properties) : [];
    if (topLevelKeys.length === 0 && propertiesKeys.length === 0) {
      throw new Error(
        'update_climate_zone requires at least one of topLevel or properties with at least one field.'
      );
    }

    const body: Record<string, any> = {};
    if (topLevelKeys.length > 0) {
      Object.assign(body, topLevel);
    }
    if (propertiesKeys.length > 0) {
      // Read-modify-write so partial submissions in nested schedule objects
      // (e.g. {monday: {morning: {...}}}) don't wipe sibling keys.
      const current = await this.makeApiRequest(`/api/panels/climate/${zoneId}`);
      const currentProps = current?.properties ?? {};
      body.properties = this.deepMerge(currentProps, properties);
    }

    await this.makeApiRequest(`/api/panels/climate/${zoneId}`, 'PUT', body);
    const after = await this.makeApiRequest(`/api/panels/climate/${zoneId}`);
    this.verifyWrite(topLevel, properties, after, `climate zone ${zoneId}`);

    const submittedSummary: Record<string, any> = {};
    if (topLevelKeys.length > 0) submittedSummary.topLevel = topLevel;
    if (propertiesKeys.length > 0) submittedSummary.properties = properties;
    return {
      zoneId,
      submitted: submittedSummary,
      verified: true
    };
  }

  // Alarm System Management Methods
  private async getAlarmPartitions(): Promise<any> {
    return await this.makeApiRequest('/api/alarms/v1/partitions');
  }

  private async getAlarmPartition(args: { partitionId: number }): Promise<any> {
    return await this.makeApiRequest(`/api/alarms/v1/partitions/${args.partitionId}`);
  }

  private async armAlarmPartition(args: { partitionId: number; armingType: string }): Promise<any> {
    await this.makeApiRequest(`/api/alarms/v1/partitions/${args.partitionId}/actions/arm`, 'POST', {
      armingType: args.armingType
    });
    return `Alarm partition ${args.partitionId} armed with ${args.armingType} mode.`;
  }

  private async disarmAlarmPartition(args: { partitionId: number }): Promise<any> {
    await this.makeApiRequest(`/api/alarms/v1/partitions/${args.partitionId}/actions/disarm`, 'POST');
    return `Alarm partition ${args.partitionId} disarmed successfully.`;
  }

  private async getAlarmHistory(args: { partitionId?: number; limit?: number; offset?: number }): Promise<any> {
    let url = '/api/alarms/v1/history';
    const params = new URLSearchParams();
    
    if (args.partitionId) {
      params.append('partitionId', args.partitionId.toString());
    }
    if (args.limit) {
      params.append('limit', args.limit.toString());
    }
    if (args.offset) {
      params.append('offset', args.offset.toString());
    }
    
    if (params.toString()) {
      url += '?' + params.toString();
    }
    
    return await this.makeApiRequest(url);
  }

  private async getAlarmDevices(args: { partitionId?: number }): Promise<any> {
    let url = '/api/alarms/v1/devices';
    if (args.partitionId) {
      url += `?partitionId=${args.partitionId}`;
    }
    return await this.makeApiRequest(url);
  }

  // Sprinkler System Management Methods
  private async getSprinklerSystems(): Promise<any> {
    return await this.makeApiRequest('/api/panels/sprinklers');
  }

  private async getSprinklerSystem(args: { systemId: number }): Promise<any> {
    return await this.makeApiRequest(`/api/panels/sprinklers/${args.systemId}`);
  }

  private async controlSprinklerSystem(args: { systemId: number; action: string; zoneId?: number; duration?: number }): Promise<any> {
    const endpoint = `/api/panels/sprinklers/${args.systemId}/actions/${args.action}`;
    const requestData: any = {};
    
    if (args.zoneId) {
      requestData.zoneId = args.zoneId;
    }
    if (args.duration) {
      requestData.duration = args.duration;
    }
    
    await this.makeApiRequest(endpoint, 'POST', Object.keys(requestData).length > 0 ? requestData : undefined);
    return `Sprinkler system ${args.systemId} action '${args.action}' executed successfully.`;
  }

  // Custom Events Management Methods
  private async getCustomEvents(): Promise<any> {
    return await this.makeApiRequest('/api/customEvents');
  }

  private async createCustomEvent(args: { name: string; userDescription?: string }): Promise<any> {
    const result = await this.makeApiRequest('/api/customEvents', 'POST', args);
    return `Custom event '${args.name}' created successfully with ID ${result.id}.`;
  }

  private async triggerCustomEvent(args: { eventId: number }): Promise<any> {
    await this.makeApiRequest(`/api/customEvents/${args.eventId}`, 'POST');
    return `Custom event ${args.eventId} triggered successfully.`;
  }

  private async getCustomEvent(args: { name: string }): Promise<any> {
    if (!args?.name) throw new Error('get_custom_event requires name.');
    return await this.makeApiRequest(`/api/customEvents/${encodeURIComponent(args.name)}`);
  }

  private async updateCustomEvent(args: {
    name: string;
    userDescription?: string;
    newName?: string;
  }): Promise<any> {
    if (!args?.name) throw new Error('update_custom_event requires name.');
    if (args.userDescription === undefined && args.newName === undefined) {
      throw new Error('update_custom_event requires at least one of userDescription or newName.');
    }
    const current: any = await this.makeApiRequest(`/api/customEvents/${encodeURIComponent(args.name)}`);
    const body: Record<string, any> = { ...current };
    if (args.userDescription !== undefined) body.userDescription = args.userDescription;
    if (args.newName !== undefined) body.name = args.newName;
    await this.makeApiRequest(`/api/customEvents/${encodeURIComponent(args.name)}`, 'PUT', body);
    const verifyName = args.newName ?? args.name;
    const after: any = await this.makeApiRequest(`/api/customEvents/${encodeURIComponent(verifyName)}`);
    if (args.userDescription !== undefined && after.userDescription !== args.userDescription) {
      throw new Error(
        `update_custom_event: post-write userDescription mismatch. Submitted ${JSON.stringify(args.userDescription)}, stored ${JSON.stringify(after.userDescription)}.`
      );
    }
    if (args.newName !== undefined && after.name !== args.newName) {
      throw new Error(
        `update_custom_event: post-write name mismatch. Submitted ${JSON.stringify(args.newName)}, stored ${JSON.stringify(after.name)}.`
      );
    }
    return { event: after, renamed: args.newName !== undefined && args.newName !== args.name };
  }

  private async deleteCustomEvent(args: { name: string }): Promise<any> {
    if (!args?.name) throw new Error('delete_custom_event requires name.');
    const encoded = encodeURIComponent(args.name);
    const existing: any = await this.makeApiRequest(`/api/customEvents/${encoded}`);
    await this.makeApiRequest(`/api/customEvents/${encoded}`, 'DELETE');
    try {
      await this.makeApiRequest(`/api/customEvents/${encoded}`);
      throw new Error(`delete_custom_event: post-delete verify failed — '${args.name}' still exists.`);
    } catch (e: any) {
      if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
    }
    return {
      deleted: args.name,
      lastUserDescription: existing?.userDescription ?? null
    };
  }

  // Location Management Methods
  private async getLocationInfo(): Promise<any> {
    return await this.makeApiRequest('/api/panels/location');
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

    const current = await this.makeApiRequest(`/api/panels/location/${locationId}`);
    const merged = this.deepMerge(current, fields);
    await this.makeApiRequest(`/api/panels/location/${locationId}`, 'PUT', merged);
    const after = await this.makeApiRequest(`/api/panels/location/${locationId}`);
    this.verifyWrite(fields, undefined, after, `location ${locationId}`);

    return {
      locationId,
      submitted: { fields },
      verified: true
    };
  }

  // Notifications Management Methods
  private async getNotifications(args: { limit?: number; offset?: number }): Promise<any> {
    let url = '/api/panels/notifications';
    const params = new URLSearchParams();
    
    if (args.limit) {
      params.append('limit', args.limit.toString());
    }
    if (args.offset) {
      params.append('offset', args.offset.toString());
    }
    
    if (params.toString()) {
      url += '?' + params.toString();
    }
    
    return await this.makeApiRequest(url);
  }

  private async markNotificationRead(args: { notificationId: number }): Promise<any> {
    await this.makeApiRequest(`/api/panels/notifications/${args.notificationId}/read`, 'POST');
    return `Notification ${args.notificationId} marked as read.`;
  }

  private async clearAllNotifications(): Promise<any> {
    await this.makeApiRequest('/api/panels/notifications/clear', 'POST');
    return 'All notifications cleared successfully.';
  }

  private async getNotification(args: { notificationId: number }): Promise<any> {
    if (typeof args?.notificationId !== 'number') throw new Error('get_notification requires numeric notificationId.');
    return await this.makeApiRequest(`/api/notificationCenter/${args.notificationId}`);
  }

  private async updateNotification(args: {
    notificationId: number;
    fields: Record<string, any>;
  }): Promise<any> {
    if (typeof args?.notificationId !== 'number') throw new Error('update_notification requires numeric notificationId.');
    if (!args?.fields || typeof args.fields !== 'object' || Array.isArray(args.fields) || Object.keys(args.fields).length === 0) {
      throw new Error('update_notification requires a non-empty fields object.');
    }
    const current: any = await this.makeApiRequest(`/api/notificationCenter/${args.notificationId}`);
    const merged = this.deepMerge(current, args.fields);
    await this.makeApiRequest(`/api/notificationCenter/${args.notificationId}`, 'PUT', merged);
    const after: any = await this.makeApiRequest(`/api/notificationCenter/${args.notificationId}`);
    this.verifyWrite(args.fields, undefined, after, `notification ${args.notificationId}`);
    return { notificationId: args.notificationId, changedFields: Object.keys(args.fields), notification: after };
  }

  private async deleteNotification(args: { notificationId: number; allow_system?: boolean }): Promise<any> {
    if (typeof args?.notificationId !== 'number') throw new Error('delete_notification requires numeric notificationId.');
    const existing: any = await this.makeApiRequest(`/api/notificationCenter/${args.notificationId}`);
    if (existing?.canBeDeleted === false && !args.allow_system) {
      throw new Error(
        `delete_notification refuses notification ${args.notificationId}: canBeDeleted=false (HC3-system-protected). Pass allow_system=true to override.`
      );
    }
    await this.makeApiRequest(`/api/notificationCenter/${args.notificationId}`, 'DELETE');
    try {
      await this.makeApiRequest(`/api/notificationCenter/${args.notificationId}`);
      throw new Error(`delete_notification: post-delete verify failed — notification ${args.notificationId} still exists.`);
    } catch (e: any) {
      if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
    }
    return {
      deleted: args.notificationId,
      lastType: existing?.type,
      lastData: existing?.data
    };
  }

  // Backup Management Methods
  private async canCreateBackup(): Promise<any> {
    return await this.makeApiRequest('/api/service/canCreateBackups');
  }

  private async getLocalBackupStatus(): Promise<any> {
    return await this.makeApiRequest('/api/service/getLocalBackupsStatus');
  }

  private async getRemoteBackupStatus(): Promise<any> {
    return await this.makeApiRequest('/api/service/getRemoteBackupsStatus');
  }

  private async getBackups(args: { type?: string }): Promise<any> {
    let url = '/api/service/backups';
    if (args.type && args.type !== 'all') {
      url += `?type=${args.type}`;
    }
    return await this.makeApiRequest(url);
  }

  private async createBackup(args: { name: string; type: string }): Promise<any> {
    const result = await this.makeApiRequest('/api/service/backups', 'POST', {
      name: args.name,
      type: args.type
    });
    return `Backup '${args.name}' of type '${args.type}' creation initiated successfully.`;
  }

  // Debug Messages Methods
  private async clearDebugMessages(): Promise<any> {
    let cleared: number | null = null;
    try {
      const before: any = await this.makeApiRequest('/api/debugMessages');
      cleared = Array.isArray(before) ? before.length
        : (Array.isArray(before?.messages) ? before.messages.length : null);
    } catch {
      // non-fatal; DELETE still proceeds, just no count
    }
    await this.makeApiRequest('/api/debugMessages', 'DELETE');
    return { cleared };
  }

  private async getDebugMessages(args: {
    tagContains?: string;
    since?: number;
    type?: string;
    limit?: number;
    maxPages?: number;
  }): Promise<any> {
    const limit = args.limit ?? 100;
    const maxPages = args.maxPages ?? 10;
    const since = args.since;
    const typeFilter = args.type;
    const tagNeedle = args.tagContains?.toLowerCase();

    const matches = (m: any) => {
      if (typeFilter && m.type !== typeFilter) return false;
      if (since !== undefined && m.timestamp < since) return false;
      if (tagNeedle && !(typeof m.tag === 'string' && m.tag.toLowerCase().includes(tagNeedle))) return false;
      return true;
    };

    const collected: any[] = [];
    let fetched = 0;
    let pages = 0;
    let cursor: number | undefined = undefined;
    let truncatedBy: 'limit' | 'maxPages' | null = null;
    let crossedSince = false;

    while (pages < maxPages) {
      const url = cursor !== undefined ? `/api/debugMessages?last=${cursor}` : '/api/debugMessages';
      const page = await this.makeApiRequest(url);
      pages++;
      const messages: any[] = page?.messages ?? [];
      fetched += messages.length;

      for (const m of messages) {
        if (matches(m)) {
          collected.push(m);
          if (collected.length >= limit) {
            truncatedBy = 'limit';
            break;
          }
        }
      }
      if (truncatedBy === 'limit') break;

      const oldest = messages[messages.length - 1]?.timestamp;
      if (since !== undefined && oldest !== undefined && oldest < since) {
        crossedSince = true;
        break;
      }

      const nextLast = page?.nextLast;
      if (!nextLast || nextLast === 0) break;
      cursor = nextLast;
    }

    if (truncatedBy === null && pages >= maxPages && !crossedSince) {
      truncatedBy = 'maxPages';
    }

    const timestamps = collected.map(m => m.timestamp).filter((t: any) => typeof t === 'number');
    return {
      summary: {
        fetched,
        matched: collected.length,
        returned: collected.length,
        pages,
        oldestTimestamp: timestamps.length ? Math.min(...timestamps) : null,
        newestTimestamp: timestamps.length ? Math.max(...timestamps) : null,
        truncatedBy,
      },
      messages: collected,
    };
  }

  // iOS Devices Management Methods
  private async getIosDevices(): Promise<any> {
    return await this.makeApiRequest('/api/iosDevices');
  }

  private async registerIosDevice(args: { deviceToken: string; name: string }): Promise<any> {
    const result = await this.makeApiRequest('/api/iosDevices', 'POST', {
      deviceToken: args.deviceToken,
      name: args.name
    });
    return `iOS device '${args.name}' registered successfully.`;
  }

  // QuickApp Management Methods
  private async getQuickApps(): Promise<any> {
    return await this.makeApiRequest('/api/quickApp/');
  }

  private async getQuickApp(args: { quickAppId: number }): Promise<any> {
    return await this.makeApiRequest(`/api/quickApp/${args.quickAppId}`);
  }

  private async restartQuickApp(args: { quickAppId: number }): Promise<any> {
    // /api/quickApp/{id}/restart does not exist on HC3 5.x — the UI uses
    // /api/plugins/restart with {deviceId} for both QAs and plugin devices.
    // restart_quickapp is now a thin alias over the same endpoint as
    // restart_plugin (different parameter name preserved for callers).
    await this.makeApiRequest('/api/plugins/restart', 'POST', { deviceId: args.quickAppId });
    return `QuickApp ${args.quickAppId} restarted successfully.`;
  }

  // System Context & Intelligence Methods
  private async getSystemContext(args: any): Promise<any> {
    try {
      // Primary fetches (devices/rooms/scenes/variables) propagate errors so
      // HC3 unreachability surfaces instead of returning empty arrays.
      // Ancillary (info/weather) tolerated and reported via _fetch_errors.
      const [infoResult, devices, rooms, scenes, variables, weatherResult] = await Promise.all([
        this.tolerantFetch('system_info', this.makeApiRequest('/api/settings/info')),
        this.makeApiRequest('/api/devices'),
        this.makeApiRequest('/api/rooms'),
        this.makeApiRequest('/api/scenes'),
        this.makeApiRequest('/api/globalVariables'),
        this.tolerantFetch('weather', this.makeApiRequest('/api/weather'))
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
        this.makeApiRequest('/api/devices'),
        this.makeApiRequest('/api/rooms'),
        this.makeApiRequest('/api/scenes')
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
        this.makeApiRequest('/api/devices'),
        this.tolerantFetch('scenes', this.makeApiRequest('/api/scenes')),
        this.tolerantFetch('variables', this.makeApiRequest('/api/globalVariables'))
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
      const devices = await this.makeApiRequest('/api/devices');

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
    
    const configurationGuide = {
      overview: 'Comprehensive HC3 configuration documentation covering all aspects of Home Center 3 setup and management.',
      
      network: {
        title: 'Network Settings',
        content: `
## Network Configuration

### LAN Connection
- DHCP: IP assigned dynamically by router
- Static: Manual IP configuration with reserved address
- Set via Configuration Interface > Network > LAN connection

### Wi-Fi Connection  
- Enable Wi-Fi and search for networks
- Support for hidden networks
- Static or DHCP IP assignment
- Access Point mode available

### Secure Connection
- HTTP: Standard connection without encryption
- HTTPS: Secure encrypted connection
- HTTP/HTTPS: Accept both connection types
- Certificate management for HTTPS

### Network Status Checking
- LED indicators on device housing
- Internet diode: Copper=connected, Red=disconnected
- LAN diode: Copper=connected, Fast pulse=connecting
- Wi-Fi diode: Copper=connected, Red=error, Green=AP mode
        `
      },

      users: {
        title: 'Users and Access Management',
        content: `
## User Management

### User Roles
- Admin: One user, full system configuration and device control
- User: Multiple users, device control and status viewing only

### Adding Users
1. Configuration Interface > Access > Users
2. Click "Add user"
3. Enter Name and E-mail (recommend FIBARO ID)
4. Local password sent to email address

### Remote Access via FIBARO ID
- Owner can share access through FIBARO ID
- Log into Remote Access portal
- Add user by FIBARO ID email
- Synchronize in Configuration Interface

### User Permissions
- Admin sets access to specific sections/devices
- Manage Access > Select sections/devices > Save
- Mobile device management per user
- PIN codes for alarm control
        `
      },

      rooms: {
        title: 'Rooms and Sections',
        content: `
## Room Organization

### Sections
- Represent areas in house (floors, wings)
- Rooms assigned to sections
- Add via Configuration Interface > Rooms > Manage sections

### Rooms
- Represent actual rooms and places
- Devices assigned to rooms
- Categories for filtering by type
- Icons for visual representation
- Default room for new devices

### Room Management
- Add/Edit/Delete rooms
- Set room category, name, section, icon
- Default room configuration in General settings
- Automatic device assignment to default room
        `
      },

      zwave: {
        title: 'Z-Wave Configuration',
        content: `
## Z-Wave Network Management

### Z-Wave Settings
- Reconfigure all devices or single devices
- Reconfigure mesh network topology
- Broadcast Node Information frames
- Secondary controller management
- Controller transfer capabilities

### Network Optimization
- Reset energy metering data
- Reset entire Z-Wave network
- Enable/disable device polling
- Configure polling intervals
- Mark unavailable nodes
- Poll unavailable devices

### Device Management
- Add/remove Z-Wave devices
- Device configuration parameters
- Association groups management
- Firmware updates
- Device inclusion/exclusion modes
        `
      },

      time: {
        title: 'Time and Location Settings',
        content: `
## Time Configuration

### Date and Time Settings
- Time zone selection
- NTP server synchronization or manual time
- Date format configuration (DD/MM/YYYY, MM/DD/YYYY)
- Hour format (12-hour or 24-hour)

### Units and Separators
- Temperature unit (Celsius/Fahrenheit)
- Wind speed unit (km/h, mph)
- Decimal mark (comma or dot)

### Location Services
- Home location for weather and automation
- Work and other location zones
- GPS coordinates and radius settings
- Location-based scene triggers
- Enter/leave zone automation
        `
      },

      location: {
        title: 'Location and Geofencing',
        content: `
## Location-Based Features

### Home Location Setup
1. Configuration Interface > General > Location
2. Drag map to home address
3. Click location to set pin
4. Set radius (typically 100m for home)
5. Save configuration

### Additional Locations
- Add work, vacation homes, etc.
- Custom names and radius settings
- Multiple location zones supported
- Location-based automation triggers

### Geofencing Automation
- Enter/leave zone triggers
- User-specific location tracking
- Mobile device GPS integration
- Scene activation based on presence
        `
      },

      voip: {
        title: 'VoIP Server Configuration',
        content: `
## VoIP Server Setup

### Home Center VoIP Server
- HC3 can act as VoIP server
- Manages VoIP connections between clients
- Requires compatible VoIP mobile apps
- Gateway must be reachable via network

### Adding VoIP Clients
1. Configuration Interface > VoIP
2. Click "Add VoIP client"
3. Enter Display name, username, password
4. Client appears in user list
5. Enable/disable clients as needed

### Mobile App Configuration
- Enter HC3 IP address in VoIP app
- Use VoIP username and password
- Various VoIP apps supported
- Test connectivity and call quality
        `
      }
    };

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
    
    const programmingGuide = {
      overview: 'Comprehensive HC3 Quick Apps programming documentation covering Lua development, networking, and device integration.',
      
      basic: {
        title: 'Quick Apps Basics',
        content: `
## Quick Apps Fundamentals

### QuickApp Class
- Object-oriented programming in Lua
- Extend QuickApp class with custom methods
- Use 'self' to reference current instance
- Built-in methods for device integration

### onInit Method
- Called when system starts Quick App
- Initialize variables and connections
- Set up HTTP clients, TCP sockets, etc.
- Not required but recommended

### Device Integration
- Quick Apps create virtual devices
- Choose appropriate device type for best integration
- Works with scenes, panels, voice assistants
- Actions mapped to methods automatically

### Example Structure:
\`\`\`lua
function QuickApp:onInit()
    self:debug("QuickApp initialized")
    self.httpClient = net.HTTPClient()
    self.myVariable = "Hello World"
end

function QuickApp:turnOn()
    self:debug("Device turned on")
    self:updateProperty("value", true)
end
\`\`\`
        `
      },

      methods: {
        title: 'QuickApp Methods',
        content: `
## Built-in QuickApp Methods

### Logging Methods
- self:debug(message, ...) - Debug level logging
- self:trace(message, ...) - Trace level logging  
- self:warning(message, ...) - Warning level logging
- self:error(message, ...) - Error level logging

### Variable Management
- self:getVariable(name) - Get Quick App variable
- self:setVariable(name, value) - Set Quick App variable

### Device Properties
- self:updateProperty(property, value) - Update device property
- self:updateView(component, attribute, value) - Update UI component

### Action Mapping
- Method names automatically map to device actions
- fibaro.call(deviceId, "methodName", args) calls method
- Arguments passed directly to method

### Example Usage:
\`\`\`lua
function QuickApp:setValue(value)
    self:updateProperty("value", value)
    self:updateView("slider1", "value", value)
    self:debug("Value set to:", value)
end
\`\`\`
        `
      },

      http: {
        title: 'HTTP Client',
        content: `
## net.HTTPClient

### Constructor
\`\`\`lua
self.http = net.HTTPClient({timeout=3000})
\`\`\`

### Request Method
\`\`\`lua
self.http:request(address, {
    options = {
        method = 'GET',
        headers = {
            Accept = "application/json"
        },
        checkCertificate = true,
        data = "request body"
    },
    success = function(response)
        self:debug("Status:", response.status)
        self:debug("Data:", response.data)
        self:debug("Headers:", response.headers)
    end,
    error = function(message)
        self:error("HTTP Error:", message)
    end
})
\`\`\`

### Features
- HTTPS support with certificate validation
- Custom headers and request methods
- JSON data handling with json.encode/decode
- Automatic timeout handling
- Response status and header access
        `
      },

      tcp: {
        title: 'TCP Socket Client',
        content: `
## net.TCPSocket

### Constructor and Connection
\`\`\`lua
self.sock = net.TCPSocket({timeout = 10000})

self.sock:connect(ip, port, {
    success = function()
        self:debug("Connected")
    end,
    error = function(message)
        self:debug("Connection error:", message)
    end
})
\`\`\`

### Sending Data
\`\`\`lua
self.sock:send(data, {
    success = function()
        self:debug("Data sent")
    end,
    error = function(message)
        self:debug("Send error:", message)
    end
})
\`\`\`

### Reading Data
\`\`\`lua
-- Read available data
self.sock:read({
    success = function(data)
        self:debug("Received:", data)
    end,
    error = function(message)
        self:debug("Read error:", message)
    end
})

-- Read until delimiter
self.sock:readUntil("\\n", {
    success = function(data)
        self:debug("Line:", data)
    end
})
\`\`\`
        `
      },

      udp: {
        title: 'UDP Socket Client',
        content: `
## net.UDPSocket

### Constructor
\`\`\`lua
self.udp = net.UDPSocket({
    broadcast = true,
    timeout = 5000
})
\`\`\`

### Sending Datagrams
\`\`\`lua
self.udp:sendTo(data, ip, port, {
    success = function()
        self:debug("Datagram sent")
    end,
    error = function(error)
        self:debug("Send error:", error)
    end
})
\`\`\`

### Receiving Datagrams
\`\`\`lua
self.udp:receive({
    success = function(data)
        self:debug("Received datagram:", data)
        self.udp:receive() -- Continue receiving
    end,
    error = function(error)
        self:debug("Receive error:", error)
    end
})
\`\`\`

### Features
- Broadcast support
- Binary data handling
- Timeout configuration
- Connectionless communication
        `
      },

      websocket: {
        title: 'WebSocket Client',
        content: `
## WebSocket Support

### Features
- WebSocket and WebSocket Secure (WSS) clients
- Real-time bidirectional communication
- Event-driven message handling
- Connection lifecycle management

### Basic Usage
- Create WebSocket connections for real-time data
- Handle connection events and messages
- Send text and binary data
- Automatic reconnection strategies

### Use Cases
- IoT device communication
- Real-time sensor data streaming
- Home automation protocol integration
- Cloud service connectivity

Note: Full WebSocket documentation available in separate HC3 manual section.
        `
      },

      mqtt: {
        title: 'MQTT Client',
        content: `
## MQTT Client Support

### Connection
\`\`\`lua
self.client = mqtt.Client.connect(brokerURI, {
    username = "user",
    password = "pass",
    clientId = "hc3_device",
    keepAlivePeriod = 60
})

self.client:addEventListener('connected', function(event)
    self:debug("MQTT Connected")
end)
\`\`\`

### Publishing
\`\`\`lua
self.client:publish("topic/name", "message", {
    qos = mqtt.QoS.AT_LEAST_ONCE,
    retain = true
})
\`\`\`

### Subscribing
\`\`\`lua
self.client:subscribe("sensors/#", {
    qos = mqtt.QoS.EXACTLY_ONCE
})

self.client:addEventListener('message', function(event)
    self:debug("Topic:", event.topic)
    self:debug("Payload:", event.payload)
end)
\`\`\`

### Features
- QoS levels support (0, 1, 2)
- TLS/SSL connections
- Last Will and Testament
- Topic filtering with wildcards
        `
      },

      child_devices: {
        title: 'Child Device Management',
        content: `
## Managing Child Devices

### Class Definition
\`\`\`lua
class 'MyBinarySwitch' (QuickAppChild)

function MyBinarySwitch:__init(device)
    QuickAppChild.__init(self, device)
    self:debug("Child device initialized")
end

function MyBinarySwitch:turnOn()
    self:debug("Child device turned on")
    self:updateProperty("value", true)
end
\`\`\`

### Creating Child Devices
\`\`\`lua
function QuickApp:createChild()
    local child = self:createChildDevice({
        name = "Child Light",
        type = "com.fibaro.binarySwitch"
    }, MyBinarySwitch)
    
    self:debug("Child created with ID:", child.id)
end
\`\`\`

### Initialization
\`\`\`lua
function QuickApp:onInit()
    self:initChildDevices({
        ["com.fibaro.binarySwitch"] = MyBinarySwitch,
        ["com.fibaro.multilevelSwitch"] = MyDimmer
    })
    
    -- Access children
    for id, device in pairs(self.childDevices) do
        self:debug("Child:", id, device.name)
    end
end
\`\`\`

### Parent Access
- Use self.parent to access parent from child
- Share resources like HTTP clients
- Centralized configuration management
        `
      }
    };

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
    
    const scenesGuide = {
      overview: 'Comprehensive HC3 Lua Scenes programming documentation covering conditions, triggers, actions, and automation logic.',
      
      conditions: {
        title: 'Scene Conditions and Triggers',
        content: `
## Conditions vs Triggers

### Trigger (isTrigger = true)
- Event that starts scene evaluation
- Must be specified for automatic scenes
- Examples: device state change, time, weather

### Condition (isTrigger = false)
- Factor that must be met for scene execution
- Checked after trigger occurs
- Examples: device states, time ranges, weather

### Logical Operators
- "all": All conditions must be met (AND)
- "any": At least one condition must be met (OR)
- Conditions can be nested for complex logic

### Example Structure:
\`\`\`json
{
    "operator": "all",
    "conditions": [
        {
            "type": "device",
            "id": 25,
            "property": "value", 
            "operator": "==",
            "value": true,
            "isTrigger": true
        },
        {
            "type": "date",
            "property": "cron",
            "operator": "match>=",
            "value": ["0", "18", "*", "*", "*", "*"]
        }
    ]
}
\`\`\`
        `
      },

      triggers: {
        title: 'Trigger Types',
        content: `
## Device Triggers
\`\`\`json
{
    "type": "device",
    "id": 30,
    "property": "value",
    "operator": ">", 
    "value": 25,
    "duration": 20,
    "isTrigger": true
}
\`\`\`

## Time Triggers
\`\`\`json
{
    "type": "date",
    "property": "cron",
    "operator": "match",
    "value": ["30", "15", "*", "*", "*", "*"],
    "isTrigger": true
}
\`\`\`

## Sunrise/Sunset
\`\`\`json
{
    "type": "date", 
    "property": "sunset",
    "operator": "==",
    "value": -60,
    "isTrigger": true
}
\`\`\`

## Weather Triggers
\`\`\`json
{
    "type": "weather",
    "property": "Temperature", 
    "operator": "<",
    "value": 20,
    "isTrigger": true
}
\`\`\`

## Custom Events
\`\`\`json
{
    "type": "custom-event",
    "property": "event_name",
    "operator": "==", 
    "isTrigger": true
}
\`\`\`

## Location Triggers
\`\`\`json
{
    "type": "location",
    "id": 36,
    "property": 2,
    "operator": "==",
    "value": "enter",
    "isTrigger": true
}
\`\`\`
        `
      },

      actions: {
        title: 'Scene Actions',
        content: `
## Device Control
\`\`\`lua
-- Control single device
fibaro.call(30, "turnOn")
fibaro.call(31, "setValue", 90)

-- Control multiple devices  
fibaro.call({30, 32}, "turnOn")

-- Group actions with filters
fibaro.callGroupAction("turnOn", {
    args = {},
    filters = {
        {
            filter = "type",
            value = ["com.fibaro.binarySwitch"]
        }
    }
})
\`\`\`

## Device Information
\`\`\`lua
-- Get device properties
local value, modTime = fibaro.get(54, "value")
local value = fibaro.getValue(54, "value")
local type = fibaro.getType(54)
local name = fibaro.getName(54)
local roomId = fibaro.getRoomID(54)
\`\`\`

## Global Variables
\`\`\`lua
-- Get/set global variables
local value = fibaro.getGlobalVariable("testVar")
fibaro.setGlobalVariable("testVar", "newValue")

-- Scene variables (persistent between runs)
local value = fibaro.getSceneVariable("sceneVar")
fibaro.setSceneVariable("sceneVar", 123)
\`\`\`

## Notifications
\`\`\`lua
-- Send notifications
fibaro.alert("email", {2,3,4}, "Test message")
fibaro.alert("push", {2}, "Push notification")

-- Emit custom events
fibaro.emitCustomEvent("TestEvent")
\`\`\`

## System Control
\`\`\`lua
-- Scene control
fibaro.scene("execute", {1, 2, 3})
fibaro.scene("kill", {4, 5})

-- Alarm control
fibaro.alarm(1, "arm")
fibaro.alarm("disarm")

-- Profile control
fibaro.profile(1, "activateProfile")
\`\`\`

## Timing
\`\`\`lua
-- Delayed execution
fibaro.setTimeout(30000, function()
    fibaro.call(40, "turnOn")
end)

-- Pause execution
fibaro.sleep(5000)
\`\`\`
        `
      },

      examples: {
        title: 'Practical Examples',
        content: `
## Motion-Activated Lighting
\`\`\`json
// Conditions
{
    "operator": "all",
    "conditions": [
        {
            "type": "device",
            "id": 54,
            "property": "value",
            "operator": "==", 
            "value": true,
            "isTrigger": true
        },
        {
            "type": "date",
            "property": "sunset", 
            "operator": ">=",
            "value": 0
        }
    ]
}
\`\`\`

\`\`\`lua
-- Actions
fibaro.call({51, 52, 53}, "turnOn")
\`\`\`

## Temperature-Based Automation
\`\`\`lua
-- Check temperature and control heating
local temp = fibaro.getValue(25, "value")
if temp < 18 then
    fibaro.call(30, "turnOn")  -- Heater on
    fibaro.alert("push", {2}, "Heating activated - temp: " .. temp)
end
\`\`\`

## Advanced Device Control
\`\`\`lua
-- Get all devices in room and control them
local roomDevices = fibaro.getDevicesID({
    interfaces = {"turnOn", "turnOff"},
    roomID = 219
})

for _, deviceId in ipairs(roomDevices) do
    local deviceType = fibaro.getType(deviceId)
    if deviceType == "com.fibaro.binarySwitch" then
        fibaro.call(deviceId, "turnOff")
    end
end
\`\`\`

## Weather-Based Irrigation
\`\`\`lua
-- Start watering based on conditions
local wateringTime = 20 -- minutes

if sourceTrigger.type == "device" or 
   (sourceTrigger.type == "weather" and 
    fibaro.getValue(35, "value") < 20) then
    
    fibaro.call(2055, "turnOn")
    fibaro.setTimeout(wateringTime * 60 * 1000, function()
        fibaro.call(2055, "turnOff")
    end)
    
    fibaro.debug("Irrigation", "Started " .. wateringTime .. " minute cycle")
end
\`\`\`
        `
      },

      api: {
        title: 'API Functions',
        content: `
## HTTP API Access
\`\`\`lua
-- Direct API calls
local data, status = api.get('/devices')
local data, status = api.post('/globalVariables', {
    name = 'test',
    value = 'sampleValue'
})
local data, status = api.put('/globalVariables/test', {
    value = 'newValue'  
})
local data, status = api.delete('/globalVariables/test')
\`\`\`

## System Services
\`\`\`lua
-- System control
fibaro.homeCenter.systemService.reboot()
fibaro.homeCenter.systemService.suspend()

-- Notification service
fibaro.homeCenter.notificationService.publish({
    type = "GenericDeviceNotification",
    priority = "info",
    data = {
        deviceId = 54,
        title = "Device Alert",
        text = "Status update"
    }
})
\`\`\`

## Data Handling
\`\`\`lua
-- JSON processing
local jsonString = json.encode(sourceTrigger)
local dataTable = json.decode(response.data)

-- Source trigger information
if sourceTrigger.type == "device" then
    local deviceId = sourceTrigger.id
    local property = sourceTrigger.property
    local value = sourceTrigger.value
end
\`\`\`

## Error Handling
\`\`\`lua
-- Safe API calls with error handling
local success, result = pcall(function()
    return fibaro.getValue(deviceId, "value")
end)

if success then
    fibaro.debug("Value:", result)
else
    fibaro.error("Failed to get value:", result)
end
\`\`\`
        `
      }
    };

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
    
    const examples = {
      overview: 'Practical HC3 programming examples and code snippets for common home automation scenarios.',
      
      lighting: {
        title: 'Lighting Control Examples',
        examples: [
          {
            name: 'Motion-Activated Lights',
            description: 'Turn on lights when motion detected, only during dark hours',
            quickapp_code: `
function QuickApp:onInit()
    self.motionSensorId = 25
    self.lightIds = {51, 52, 53}
end

function QuickApp:checkMotion()
    local motionValue = fibaro.getValue(self.motionSensorId, "value")
    local currentHour = tonumber(os.date("%H"))
    
    if motionValue and (currentHour < 7 or currentHour > 20) then
        for _, lightId in ipairs(self.lightIds) do
            fibaro.call(lightId, "turnOn")
        end
        
        -- Turn off after 10 minutes
        fibaro.setTimeout(600000, function()
            for _, lightId in ipairs(self.lightIds) do
                fibaro.call(lightId, "turnOff")
            end
        end)
    end
end
            `,
            scene_trigger: `
{
    "operator": "all",
    "conditions": [
        {
            "type": "device",
            "id": 25,
            "property": "value",
            "operator": "==",
            "value": true,
            "isTrigger": true
        }
    ]
}
            `,
            scene_action: `
local currentHour = tonumber(os.date("%H"))
if currentHour < 7 or currentHour > 20 then
    fibaro.call({51, 52, 53}, "turnOn")
    
    fibaro.setTimeout(600000, function()
        fibaro.call({51, 52, 53}, "turnOff") 
    end)
end
            `
          },
          {
            name: 'Dimmer Sunset Automation',
            description: 'Gradually dim lights based on sunset time',
            quickapp_code: `
function QuickApp:onInit()
    self.dimmerIds = {60, 61, 62}
    self:scheduleNextDimming()
end

function QuickApp:scheduleDimming()
    -- Get sunset time and start dimming 30 minutes before
    local sunsetTime = fibaro.getValue(1, "sunsetHour") 
    local dimStartTime = sunsetTime - 0.5 -- 30 minutes before
    
    fibaro.setTimeout(self:timeUntil(dimStartTime), function()
        self:startGradualDim()
    end)
end

function QuickApp:startGradualDim()
    local steps = 10
    local stepDelay = 300000 -- 5 minutes
    
    for step = 1, steps do
        fibaro.setTimeout(stepDelay * (step - 1), function()
            local brightness = 100 - (step * 10)
            for _, dimmerId in ipairs(self.dimmerIds) do
                fibaro.call(dimmerId, "setValue", brightness)
            end
        end)
    end
end
            `
          }
        ]
      },

      security: {
        title: 'Security and Monitoring Examples',
        examples: [
          {
            name: 'Door/Window Security Monitor',
            description: 'Monitor door and window sensors, send alerts and activate cameras',
            quickapp_code: `
function QuickApp:onInit()
    self.doorSensors = {70, 71, 72}
    self.cameras = {80, 81}
    self.users = {2, 3} -- User IDs for notifications
end

function QuickApp:checkSecurity()
    for _, sensorId in ipairs(self.doorSensors) do
        local isOpen = fibaro.getValue(sensorId, "value")
        local sensorName = fibaro.getName(sensorId)
        
        if isOpen then
            -- Send immediate alert
            fibaro.alert("push", self.users, 
                sensorName .. " opened - security alert!")
            
            -- Activate cameras
            for _, cameraId in ipairs(self.cameras) do
                fibaro.call(cameraId, "startRecording")
            end
            
            -- Log event
            self:debug("Security breach:", sensorName)
            
            -- Check if alarm is armed
            local alarmArmed = fibaro.getValue(1, "armed")
            if alarmArmed then
                fibaro.alarm("breach")
            end
        end
    end
end
            `,
            scene_action: `
-- Water leak detection and response
local waterSensors = {90, 91, 92}
local shutoffValves = {100, 101}

for _, sensorId in ipairs(waterSensors) do
    local waterDetected = fibaro.getValue(sensorId, "value")
    if waterDetected then
        -- Emergency shutoff
        for _, valveId in ipairs(shutoffValves) do
            fibaro.call(valveId, "close")
        end
        
        -- Alert all users
        fibaro.alert("email", {2,3,4}, "WATER LEAK DETECTED - Valves closed!")
        fibaro.alert("push", {2,3,4}, "Water leak emergency!")
        
        break
    end
end
            `
          }
        ]
      },

      climate: {
        title: 'Climate Control Examples', 
        examples: [
          {
            name: 'Smart Thermostat Logic',
            description: 'Intelligent heating/cooling based on occupancy and weather',
            quickapp_code: `
function QuickApp:onInit()
    self.thermostatId = 40
    self.tempSensors = {41, 42, 43}
    self.presenceSensors = {50, 51}
    self.targetTemp = 22
    self.checkInterval = 300000 -- 5 minutes
    
    self:startThermostatLoop()
end

function QuickApp:startThermostatLoop()
    fibaro.setTimeout(self.checkInterval, function()
        self:updateThermostat()
        self:startThermostatLoop()
    end)
end

function QuickApp:updateThermostat()
    local avgTemp = self:getAverageTemperature()
    local isOccupied = self:isHomeOccupied()
    local weatherTemp = fibaro.getValue(1, "TemperatureOutdoor")
    
    local targetTemp = self.targetTemp
    
    -- Adjust based on occupancy
    if not isOccupied then
        targetTemp = targetTemp - 3 -- Energy saving
    end
    
    -- Adjust based on weather
    if weatherTemp < 0 then
        targetTemp = targetTemp + 1 -- Extra warmth in cold weather
    end
    
    -- Set thermostat
    fibaro.call(self.thermostatId, "setTargetLevel", targetTemp)
    
    self:debug("Climate update:", {
        avgTemp = avgTemp,
        targetTemp = targetTemp,
        occupied = isOccupied,
        outdoorTemp = weatherTemp
    })
end

function QuickApp:getAverageTemperature()
    local total = 0
    local count = 0
    
    for _, sensorId in ipairs(self.tempSensors) do
        local temp = fibaro.getValue(sensorId, "value")
        if temp then
            total = total + temp
            count = count + 1
        end
    end
    
    return count > 0 and (total / count) or self.targetTemp
end

function QuickApp:isHomeOccupied()
    for _, sensorId in ipairs(self.presenceSensors) do
        if fibaro.getValue(sensorId, "value") then
            return true
        end
    end
    return false
end
            `
          }
        ]
      },

      scenes: {
        title: 'Scene Management Examples',
        examples: [
          {
            name: 'Scene Orchestration',
            description: 'Coordinate multiple scenes for complex automation',
            scene_action: `
-- Morning routine scene orchestration
local currentTime = os.date("*t")
local isWeekday = currentTime.wday >= 2 and currentTime.wday <= 6

if isWeekday then
    -- Gradual wake up sequence
    fibaro.scene("execute", {10}) -- Wake up lighting
    
    fibaro.setTimeout(300000, function() -- 5 minutes later
        fibaro.scene("execute", {11}) -- Morning music
    end)
    
    fibaro.setTimeout(600000, function() -- 10 minutes later  
        fibaro.scene("execute", {12}) -- Coffee maker
    end)
    
    fibaro.setTimeout(1800000, function() -- 30 minutes later
        fibaro.scene("execute", {13}) -- Departure preparation
    end)
else
    -- Weekend routine (more relaxed)
    fibaro.scene("execute", {20}) -- Gentle weekend wake up
end

-- Log routine start
fibaro.setGlobalVariable("lastMorningRoutine", os.date("%Y-%m-%d %H:%M:%S"))
            `
          }
        ]
      },

      devices: {
        title: 'Device Integration Examples',
        examples: [
          {
            name: 'Multi-Protocol Device Bridge',
            description: 'Bridge devices between different protocols using Quick Apps',
            quickapp_code: `
function QuickApp:onInit()
    -- HTTP client for REST API devices
    self.httpClient = net.HTTPClient({timeout = 5000})
    
    -- MQTT client for IoT devices  
    self.mqttClient = mqtt.Client.connect("mqtt://192.168.1.100", {
        username = "hc3",
        password = "password"
    })
    
    -- TCP client for proprietary protocols
    self.tcpClient = net.TCPSocket()
    
    self:setupEventHandlers()
    self:discoverDevices()
end

function QuickApp:setupEventHandlers()
    self.mqttClient:addEventListener('connected', function()
        self:debug("MQTT connected")
        self.mqttClient:subscribe("devices/+/state")
    end)
    
    self.mqttClient:addEventListener('message', function(event)
        self:handleMqttMessage(event.topic, event.payload)
    end)
end

function QuickApp:handleMqttMessage(topic, payload) 
    local deviceId = topic:match("devices/(%w+)/state")
    if deviceId then
        local data = json.decode(payload)
        self:updateVirtualDevice(deviceId, data)
    end
end

function QuickApp:updateVirtualDevice(deviceId, data)
    -- Map external device to HC3 virtual device
    local hc3DeviceId = self:getHC3DeviceId(deviceId)
    if hc3DeviceId then
        if data.state == "on" then
            fibaro.call(hc3DeviceId, "turnOn")
        else
            fibaro.call(hc3DeviceId, "turnOff")
        end
        
        if data.brightness then
            fibaro.call(hc3DeviceId, "setValue", data.brightness)
        end
    end
end
            `
          }
        ]
      },

      mqtt: {
        title: 'MQTT Integration Examples',
        examples: [
          {
            name: 'Home Assistant Integration',
            description: 'Bidirectional integration with Home Assistant via MQTT',
            quickapp_code: `
function QuickApp:onInit()
    self.mqttBroker = self:getVariable("mqttBroker")
    self.haPrefix = "homeassistant"
    
    self.client = mqtt.Client.connect(self.mqttBroker, {
        username = self:getVariable("mqttUser"),
        password = self:getVariable("mqttPass"),
        clientId = "fibaro_hc3"
    })
    
    self:setupMqttHandlers()
end

function QuickApp:setupMqttHandlers()
    self.client:addEventListener('connected', function()
        self:debug("Connected to Home Assistant MQTT")
        self:publishDeviceDiscovery()
        self:subscribeToCommands()
    end)
    
    self.client:addEventListener('message', function(event)
        self:handleHomeAssistantCommand(event.topic, event.payload)
    end)
end

function QuickApp:publishDeviceDiscovery()
    -- Publish HC3 devices to Home Assistant
    local devices = api.get("/devices")
    
    for _, device in ipairs(devices) do
        if device.type == "com.fibaro.binarySwitch" then
            local config = {
                name = device.name,
                state_topic = self.haPrefix .. "/switch/" .. device.id .. "/state",
                command_topic = self.haPrefix .. "/switch/" .. device.id .. "/set",
                unique_id = "fibaro_" .. device.id
            }
            
            self.client:publish(
                self.haPrefix .. "/switch/" .. device.id .. "/config",
                json.encode(config),
                {retain = true}
            )
        end
    end
end

function QuickApp:subscribeToCommands() 
    self.client:subscribe(self.haPrefix .. "/switch/+/set")
    self.client:subscribe(self.haPrefix .. "/light/+/set")
end

function QuickApp:handleHomeAssistantCommand(topic, payload)
    local deviceId = topic:match("/(%d+)/set")
    if deviceId then
        if payload == "ON" then
            fibaro.call(tonumber(deviceId), "turnOn")
        elseif payload == "OFF" then
            fibaro.call(tonumber(deviceId), "turnOff")
        end
    end
end

function QuickApp:publishDeviceState(deviceId, state)
    local topic = self.haPrefix .. "/switch/" .. deviceId .. "/state"
    self.client:publish(topic, state and "ON" or "OFF")
end
            `
          }
        ]
      },

      tcp: {
        title: 'TCP Protocol Examples',
        examples: [
          {
            name: 'Global Cache Integration',
            description: 'Control IR and relay devices via Global Cache modules',
            quickapp_code: `
function QuickApp:onInit()
    self.gcIP = self:getVariable("globalCacheIP") 
    self.gcPort = 4998
    self.socket = net.TCPSocket()
    
    self:connectToGlobalCache()
end

function QuickApp:connectToGlobalCache()
    self.socket:connect(self.gcIP, self.gcPort, {
        success = function()
            self:debug("Connected to Global Cache")
            self:sendCommand("getversion")
        end,
        error = function(message)
            self:error("Connection failed:", message)
            -- Retry in 30 seconds
            fibaro.setTimeout(30000, function()
                self:connectToGlobalCache()
            end)
        end
    })
end

function QuickApp:sendIRCommand(module, connector, code)
    -- Send IR command format: sendir,module:connector,id,frequency,repeat,offset,data
    local command = string.format("sendir,%d:%d,1,38000,1,1,%s\\r", 
        module, connector, code)
    
    self.socket:send(command, {
        success = function()
            self:debug("IR command sent")
        end,
        error = function(message)
            self:error("Send failed:", message)
        end
    })
end

function QuickApp:turnOnTV()
    -- Samsung TV power on code example
    local samsungPowerCode = "9000,4500,560,560,560,560,560,1690,560,560,560,1690,560,1690,560,1690,560,560"
    self:sendIRCommand(1, 1, samsungPowerCode)
end

function QuickApp:setRelayState(module, connector, state)
    -- Control relay: setstate,module:connector,state (0=off, 1=on)
    local command = string.format("setstate,%d:%d,%d\\r", 
        module, connector, state and 1 or 0)
    
    self.socket:send(command, {
        success = function()
            self:debug("Relay state set to", state)
        end
    })
end
            `
          }
        ]
      }
    };

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

  // QuickApp file manipulation methods
  private async listQuickAppFiles(args: { deviceId: number }): Promise<any> {
    const { deviceId } = args;
    return await this.makeApiRequest(`/api/quickApp/${deviceId}/files`);
  }

  private async getQuickAppFile(args: { deviceId: number; fileName: string }): Promise<any> {
    const { deviceId, fileName } = args;
    return await this.makeApiRequest(`/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`);
  }

  private async createQuickAppFile(args: {
    deviceId: number;
    name: string;
    type?: string;
    content?: string;
    isOpen?: boolean
  }): Promise<any> {
    const { deviceId, name, type = 'lua', content = '', isOpen = false } = args;
    const fileData = {
      name,
      type,
      content,
      isOpen,
      isMain: false
    };
    const postResult = await this.makeApiRequest(`/api/quickApp/${deviceId}/files`, 'POST', fileData);

    const after = await this.makeApiRequest(
      `/api/quickApp/${deviceId}/files/${encodeURIComponent(name)}`
    );
    if (!after) {
      throw new Error(`create_quickapp_file: file '${name}' not present after POST on device ${deviceId}.`);
    }
    if (after.content !== content) {
      throw new Error(
        `create_quickapp_file: content mismatch after POST on device ${deviceId}, file '${name}'. ` +
        `Submitted ${content.length} chars, HC3 stored ${(after.content ?? '').length} chars.`
      );
    }

    return postResult;
  }

  private async updateQuickAppFile(args: {
    deviceId: number;
    fileName: string;
    content?: string;
    isOpen?: boolean
  }): Promise<any> {
    const { deviceId, fileName, content, isOpen } = args;
    const updateData: any = {};
    if (content !== undefined) {
      updateData.content = content;
    }
    if (isOpen !== undefined) {
      updateData.isOpen = isOpen;
    }

    const putResult = await this.makeApiRequest(
      `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`,
      'PUT',
      updateData
    );

    if (content !== undefined) {
      const after = await this.makeApiRequest(
        `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`
      );
      if (after?.content !== content) {
        throw new Error(
          `update_quickapp_file: content mismatch after PUT on device ${deviceId}, file '${fileName}'. ` +
          `Submitted ${content.length} chars, HC3 stored ${(after?.content ?? '').length} chars. ` +
          `The write was silently altered or dropped.`
        );
      }
    }

    return putResult;
  }

  private async updateMultipleQuickAppFiles(args: {
    deviceId: number;
    files: Array<{ name: string; content: string; type?: string; isOpen?: boolean }>
  }): Promise<any> {
    const { deviceId, files } = args;
    const existing = await this.makeApiRequest(`/api/quickApp/${deviceId}/files`);
    const isMainByName = new Map<string, boolean>(
      (existing ?? []).map((f: any) => [f.name, !!f.isMain])
    );
    const filesData = files.map(file => ({
      name: file.name,
      content: file.content,
      type: file.type || 'lua',
      isOpen: file.isOpen || false,
      isMain: isMainByName.get(file.name) ?? false
    }));
    const putResult = await this.makeApiRequest(`/api/quickApp/${deviceId}/files`, 'PUT', filesData);

    const stored = await Promise.all(
      files.map(f =>
        this.makeApiRequest(`/api/quickApp/${deviceId}/files/${encodeURIComponent(f.name)}`)
          .then((v: any) => ({ name: f.name, content: v?.content ?? null }))
          .catch(() => ({ name: f.name, content: null }))
      )
    );
    const storedByName = new Map(stored.map(s => [s.name, s.content]));
    const mismatches: string[] = [];
    for (const submitted of files) {
      const c = storedByName.get(submitted.name);
      if (c === null || c === undefined) {
        mismatches.push(`  - '${submitted.name}': missing after PUT (not created or fetch failed)`);
      } else if (c !== submitted.content) {
        mismatches.push(
          `  - '${submitted.name}': content mismatch (submitted ${submitted.content.length} chars, stored ${c.length} chars)`
        );
      }
    }
    if (mismatches.length > 0) {
      throw new Error(
        `update_multiple_quickapp_files: ${mismatches.length}/${files.length} files did not round-trip correctly on device ${deviceId}:\n` +
        mismatches.join('\n')
      );
    }

    return putResult;
  }

  private async deleteQuickAppFile(args: { deviceId: number; fileName: string }): Promise<any> {
    const { deviceId, fileName } = args;
    return await this.makeApiRequest(
      `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`,
      'DELETE'
    );
  }

  private async getQuickAppVariable(args: { deviceId: number; name: string }): Promise<any> {
    const { deviceId, name } = args;
    const device = await this.makeApiRequest(`/api/devices/${deviceId}`);
    const vars: any[] = device?.properties?.quickAppVariables ?? [];
    const found = vars.find(v => v.name === name);
    if (!found) {
      return { deviceId, name, exists: false };
    }
    return {
      deviceId,
      name,
      type: found.type,
      value: found.value,
      exists: true
    };
  }

  private async setQuickAppVariable(args: {
    deviceId: number;
    name: string;
    value: string | number | boolean;
  }): Promise<any> {
    const { deviceId, name, value } = args;

    const device = await this.makeApiRequest(`/api/devices/${deviceId}`);
    const vars: any[] = device?.properties?.quickAppVariables ?? [];
    const existing = vars.find(v => v.name === name);
    if (!existing) {
      const known = vars.map(v => v.name).join(', ') || '(none)';
      throw new Error(
        `QuickApp variable '${name}' does not exist on device ${deviceId}. ` +
        `Known variables: ${known}. Create new variables via the HC3 UI.`
      );
    }

    const declaredType = existing.type;
    let coercedValue: any;
    if (declaredType === 'string') {
      coercedValue = String(value);
    } else if (declaredType === 'number' || declaredType === 'integer') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new Error(
          `Cannot set numeric variable '${name}' to non-numeric value ${JSON.stringify(value)}.`
        );
      }
      coercedValue = declaredType === 'integer' ? Math.trunc(n) : n;
    } else if (declaredType === 'bool' || declaredType === 'boolean') {
      if (typeof value === 'boolean') coercedValue = value;
      else if (value === 'true' || value === 1) coercedValue = true;
      else if (value === 'false' || value === 0) coercedValue = false;
      else {
        throw new Error(
          `Cannot set boolean variable '${name}' to value ${JSON.stringify(value)}.`
        );
      }
    } else {
      coercedValue = value;
    }

    const newVars = vars.map(v =>
      v.name === name ? { ...v, value: coercedValue } : v
    );

    await this.makeApiRequest(`/api/devices/${deviceId}`, 'PUT', {
      properties: { quickAppVariables: newVars }
    });

    const after = await this.makeApiRequest(`/api/devices/${deviceId}`);
    const afterVars: any[] = after?.properties?.quickAppVariables ?? [];
    const afterVar = afterVars.find(v => v.name === name);
    if (!afterVar) {
      throw new Error(
        `Post-write verification failed: variable '${name}' missing after set on device ${deviceId}.`
      );
    }
    if (String(afterVar.value) !== String(coercedValue)) {
      throw new Error(
        `Post-write value mismatch for '${name}' on device ${deviceId}: ` +
        `requested ${JSON.stringify(coercedValue)}, HC3 stored ${JSON.stringify(afterVar.value)}.`
      );
    }
    if (afterVar.type !== declaredType) {
      throw new Error(
        `Post-write type mismatch for '${name}' on device ${deviceId}: ` +
        `declared type was '${declaredType}', HC3 now reports '${afterVar.type}'.`
      );
    }

    return {
      deviceId,
      name,
      previous: { type: existing.type, value: existing.value },
      current: { type: afterVar.type, value: afterVar.value }
    };
  }

  private async exportQuickApp(args: { 
    deviceId: number; 
    encrypted?: boolean; 
    serialNumbers?: string[] 
  }): Promise<any> {
    const { deviceId, encrypted = false, serialNumbers } = args;
    
    if (encrypted && serialNumbers && serialNumbers.length > 0) {
      const exportData = {
        encrypted: true,
        serialNumbers
      };
      return await this.makeApiRequest(`/api/quickApp/export/${deviceId}`, 'POST', exportData);
    } else {
      // Export as open source
      return await this.makeApiRequest(`/api/quickApp/export/${deviceId}`, 'POST', { encrypted: false });
    }
  }

  private async createQuickApp(args: {
    name: string;
    type: string;
    roomId?: number;
    initialProperties?: Record<string, any>;
    initialInterfaces?: string[];
    initialView?: Record<string, any>;
  }): Promise<any> {
    if (!args?.name || !args?.type) {
      throw new Error('create_quickapp requires name and type.');
    }
    const body: Record<string, any> = {
      name: args.name,
      type: args.type,
    };
    if (args.roomId !== undefined) body.roomId = args.roomId;
    if (args.initialProperties !== undefined) body.initialProperties = args.initialProperties;
    if (args.initialInterfaces !== undefined) body.initialInterfaces = args.initialInterfaces;
    if (args.initialView !== undefined) body.initialView = args.initialView;

    const created: any = await this.makeApiRequest('/api/quickApp', 'POST', body);
    const newId = created?.id;
    if (typeof newId !== 'number') {
      throw new Error(
        `create_quickapp: HC3 accepted the POST but did not return a device id. Raw response: ${JSON.stringify(created).slice(0, 400)}`
      );
    }

    const after: any = await this.makeApiRequest(`/api/devices/${newId}`);
    if (after?.name !== args.name) {
      throw new Error(
        `create_quickapp: post-create name mismatch for device ${newId}. ` +
        `Submitted name ${JSON.stringify(args.name)}, HC3 stored ${JSON.stringify(after?.name)}.`
      );
    }
    if (after?.type !== args.type) {
      throw new Error(
        `create_quickapp: post-create type mismatch for device ${newId}. ` +
        `Submitted type ${JSON.stringify(args.type)}, HC3 stored ${JSON.stringify(after?.type)}.`
      );
    }

    return {
      deviceId: newId,
      name: after.name,
      type: after.type,
      roomID: after.roomID,
      device: after
    };
  }

  private async getQuickAppAvailableTypes(): Promise<any> {
    return await this.makeApiRequest('/api/quickApp/availableTypes');
  }

  private async importQuickApp(args: { filePath: string; roomId?: number }): Promise<any> {
    const { filePath, roomId } = args;
    
    // Note: This is a simplified implementation. In a real scenario, you would need to:
    // 1. Read the file from the filesystem
    // 2. Create a FormData object with the file
    // 3. Send it as multipart/form-data
    
    throw new Error('QuickApp import requires file upload functionality that is not yet implemented. Use the Fibaro web interface for imports.');
  }

  // Plugin management methods
  private async getPlugins(args: any): Promise<any> {
    return await this.makeApiRequest('/api/plugins');
  }

  private async getInstalledPlugins(args: any): Promise<any> {
    return await this.makeApiRequest('/api/plugins/installed');
  }

  private async getPluginTypes(args: { language?: string }): Promise<any> {
    const { language = 'en' } = args;
    
    // For now, we'll use the basic API request without custom headers
    // The language preference can be handled by the client
    return await this.makeApiRequest('/api/plugins/types');
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
    return await this.makeApiRequest(url);
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
    return await this.makeApiRequest('/api/plugins/updateView', 'POST', updateData);
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
    
    return await this.makeApiRequest(url, 'GET');
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
    return await this.makeApiRequest('/api/plugins/createChildDevice', 'POST', deviceData);
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
    return await this.makeApiRequest('/api/plugins/interfaces', 'POST', requestData);
  }

  private async restartPlugin(args: { deviceId: number }): Promise<any> {
    const { deviceId } = args;
    const requestData = { deviceId };
    return await this.makeApiRequest('/api/plugins/restart', 'POST', requestData);
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
    return await this.makeApiRequest('/api/plugins/updateProperty', 'POST', requestData);
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
    
    return await this.makeApiRequest('/api/plugins/publishEvent', 'POST', eventData);
  }

  private async getIPCameras(args: any): Promise<any> {
    return await this.makeApiRequest('/api/plugins/ipCameras');
  }

  private async installPlugin(args: { type: string }): Promise<any> {
    const { type } = args;
    const url = `/api/plugins/installed?type=${encodeURIComponent(type)}`;
    return await this.makeApiRequest(url, 'POST');
  }

  private async deletePlugin(args: { type: string; allow_bulk?: boolean }): Promise<any> {
    const { type } = args;
    if (!type) throw new Error('delete_plugin requires type.');
    const devices: any[] = await this.makeApiRequest(`/api/devices?type=${encodeURIComponent(type)}`);
    if (devices.length > 1 && !args.allow_bulk) {
      throw new Error(
        `delete_plugin would uninstall ${devices.length} devices of type '${type}' (ids: ${devices.map(d => d.id).slice(0, 10).join(', ')}${devices.length > 10 ? ', …' : ''}). ` +
        `Pass allow_bulk=true to proceed, or use delete_device(deviceId) for a single-device removal.`
      );
    }
    const url = `/api/plugins/installed?type=${encodeURIComponent(type)}`;
    const res = await this.makeApiRequest(url, 'DELETE');
    return {
      type,
      devicesAffected: devices.length,
      deviceIds: devices.map(d => d.id),
      raw: res
    };
  }

  private async deleteDevice(args: { deviceId: number; cascade?: boolean; allow_physical?: boolean }): Promise<any> {
    if (typeof args?.deviceId !== 'number') {
      throw new Error('delete_device requires numeric deviceId.');
    }
    if (args.deviceId < 10) {
      throw new Error(
        `delete_device refuses deviceId ${args.deviceId}: ids < 10 are reserved HC3 system devices.`
      );
    }

    const device: any = await this.makeApiRequest(`/api/devices/${args.deviceId}`);
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

    const children: any[] = await this.makeApiRequest(`/api/devices?parentId=${args.deviceId}`);
    if (children.length > 0 && !args.cascade) {
      const childSummary = children.slice(0, 10).map(c => `${c.id} (${c.name})`).join(', ');
      throw new Error(
        `delete_device refuses device ${args.deviceId} (${device.name}): has ${children.length} children. ` +
        `HC3 will delete them silently. Pass cascade=true to proceed. Children: ${childSummary}${children.length > 10 ? ', …' : ''}`
      );
    }

    await this.makeApiRequest(`/api/devices/${args.deviceId}`, 'DELETE');

    try {
      await this.makeApiRequest(`/api/devices/${args.deviceId}`);
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
  }

  private async deleteGlobalVariable(args: { varName: string; allow_system?: boolean }): Promise<any> {
    if (typeof args?.varName !== 'string' || args.varName.length === 0) {
      throw new Error('delete_global_variable requires a non-empty varName.');
    }
    const encoded = encodeURIComponent(args.varName);

    const existing: any = await this.makeApiRequest(`/api/globalVariables/${encoded}`);
    if (existing?.readOnly && !args.allow_system) {
      throw new Error(
        `delete_global_variable refuses '${args.varName}': variable is readOnly (HC3 system variable). Pass allow_system=true to override.`
      );
    }

    await this.makeApiRequest(`/api/globalVariables/${encoded}`, 'DELETE');

    try {
      await this.makeApiRequest(`/api/globalVariables/${encoded}`);
      throw new Error(
        `delete_global_variable: post-delete verify failed — '${args.varName}' still exists after DELETE.`
      );
    } catch (e: any) {
      if (!/404|not.?found/i.test(String(e?.message ?? ''))) throw e;
    }

    return {
      deleted: args.varName,
      lastValue: existing?.value,
      wasEnum: !!existing?.isEnum,
      wasReadOnly: !!existing?.readOnly
    };
  }

  private sendResponse(response: MCPResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
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
