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

    this.setupStdioHandler();
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
          this.handleMessage(line);
        }
      }
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });

    // Log server startup to stderr (not stdout which is used for MCP communication)
    console.error('Fibaro HC3 MCP server running on stdio');
  }

  private async handleMessage(message: string): Promise<void> {
    let request: MCPRequest;
    try {
      request = JSON.parse(message);
    } catch (error) {
      this.sendError(undefined, -32700, 'Parse error');
      return;
    }

    // Notifications (no id, or method starts with "notifications/") must not receive a response.
    if (request.id === undefined || request.method?.startsWith('notifications/')) {
      return;
    }

    try {
      switch (request.method) {
        case 'initialize':
          this.handleInitialize(request);
          break;
        case 'tools/list':
          this.handleListTools(request);
          break;
        case 'tools/call':
          await this.handleCallTool(request);
          break;
        default:
          this.sendError(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      this.sendError(request.id, -32603, 'Internal error');
    }
  }

  private handleInitialize(request: MCPRequest): void {
    this.sendResponse({
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
    });
  }

  private handleListTools(request: MCPRequest): void {
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
        description: 'Control a device by calling an action (e.g., turnOn, turnOff, setValue, setColor)',
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
        description: 'Modify device properties like name, room assignment, or configuration parameters',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'Device ID',
            },
            properties: {
              type: 'object',
              description: 'Device properties to modify (e.g., {name: "New Name", roomID: 5})',
            },
          },
          required: ['deviceId', 'properties'],
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
            interval: {
              type: 'string',
              description: 'Time interval (hour, day, week, month, year)',
              enum: ['hour', 'day', 'week', 'month', 'year'],
            },
          },
        },
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

      // User Management
      {
        name: 'get_users',
        description: 'Get all users configured in the HC3 system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // Diagnostic Information
      {
        name: 'get_diagnostics',
        description: 'Get system diagnostic information',
        inputSchema: {
          type: 'object',
          properties: {},
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
        description: 'Update climate zone settings',
        inputSchema: {
          type: 'object',
          properties: {
            zoneId: {
              type: 'number',
              description: 'Climate zone ID',
            },
            settings: {
              type: 'object',
              description: 'Climate zone settings to update',
            },
          },
          required: ['zoneId', 'settings'],
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
        description: 'Update location and geofencing settings',
        inputSchema: {
          type: 'object',
          properties: {
            settings: {
              type: 'object',
              description: 'Location settings to update',
            },
          },
          required: ['settings'],
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
            includeExamples: {
              type: 'boolean',
              description: 'Include usage examples and best practices (default: true)',
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
        description: "Export a QuickApp to .fqa file format. Can export as open source or encrypted.",
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
        description: "Update a device property value directly.",
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
        description: "Delete/uninstall a plugin by type.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Plugin type to delete"
            }
          },
          required: ["type"]
        }
      },
    ];

    this.sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools,
      },
    });
  }

  private async handleCallTool(request: MCPRequest): Promise<void> {
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
        case 'control_device':
          result = await this.controlDevice(args);
          break;
        case 'modify_device':
          result = await this.modifyDevice(args);
          break;

        // Room Management
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
        case 'modify_scene':
          result = await this.modifyScene(args);
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
        case 'set_global_variable':
          result = await this.setGlobalVariable(args);
          break;

        // User Management
        case 'get_users':
          result = await this.getUsers();
          break;

        // Diagnostic Information
        case 'get_diagnostics':
          result = await this.getDiagnostics();
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
        case 'delete_quickapp_file':
          result = await this.deleteQuickAppFile(args);
          break;
        case 'export_quickapp':
          result = await this.exportQuickApp(args);
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
        case 'delete_plugin':
          result = await this.deletePlugin(args);
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      this.sendResponse({
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
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendError(request.id, -32000, errorMessage);
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
    return JSON.parse(text);
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

  private async controlDevice(args: { deviceId: number; action: string; args?: any[]; delay?: number }): Promise<any> {
    const endpoint = `/api/devices/${args.deviceId}/action/${args.action}`;
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

  private async modifyDevice(args: { deviceId: number; properties: any }): Promise<any> {
    const result = await this.makeApiRequest(`/api/devices/${args.deviceId}`, 'PUT', args.properties);
    return `Device ${args.deviceId} modified successfully. Updated properties: ${JSON.stringify(result)}`;
  }

  // Room Management Methods
  private async getRooms(): Promise<any> {
    return await this.makeApiRequest('/api/rooms');
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
    await this.makeApiRequest(`/api/scenes/${args.sceneId}/action/start`, 'POST');
    return `Scene ${args.sceneId} started successfully.`;
  }

  private async stopScene(args: { sceneId: number }): Promise<any> {
    await this.makeApiRequest(`/api/scenes/${args.sceneId}/action/stop`, 'POST');
    return `Scene ${args.sceneId} stopped successfully.`;
  }

  private async modifyScene(args: { sceneId: number; properties: Record<string, any> }): Promise<any> {
    if (!args?.properties || Object.keys(args.properties).length === 0) {
      throw new Error('modify_scene requires at least one field in properties.');
    }
    await this.makeApiRequest(`/api/scenes/${args.sceneId}`, 'PUT', args.properties);
    const updated = await this.makeApiRequest(`/api/scenes/${args.sceneId}`);
    return {
      sceneId: args.sceneId,
      changedFields: Object.keys(args.properties),
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
  private async getEnergyData(args: { deviceId?: number; interval?: string }): Promise<any> {
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

  private async setGlobalVariable(args: { varName: string; value: any }): Promise<any> {
    await this.makeApiRequest(`/api/globalVariables/${args.varName}`, 'PUT', { value: args.value });
    return `Global variable '${args.varName}' set to '${args.value}' successfully.`;
  }

  // User Management Methods
  private async getUsers(): Promise<any> {
    return await this.makeApiRequest('/api/users');
  }

  // Diagnostic Methods
  private async getDiagnostics(): Promise<any> {
    return await this.makeApiRequest('/api/diagnostics');
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
    await this.makeApiRequest('/api/panels/location', 'PUT', { mode: args.status });
    return `Home status set to '${args.status}' successfully.`;
  }

  // Climate Management Methods
  private async getClimateZones(args: { detailed?: boolean }): Promise<any> {
    const detailed = args.detailed ? '?detailed=true' : '';
    return await this.makeApiRequest(`/api/panels/climate${detailed}`);
  }

  private async getClimateZone(args: { zoneId: number }): Promise<any> {
    return await this.makeApiRequest(`/api/panels/climate/${args.zoneId}`);
  }

  private async updateClimateZone(args: { zoneId: number; settings: any }): Promise<any> {
    await this.makeApiRequest(`/api/panels/climate/${args.zoneId}`, 'PUT', args.settings);
    return `Climate zone ${args.zoneId} updated successfully.`;
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

  // Location Management Methods
  private async getLocationInfo(): Promise<any> {
    return await this.makeApiRequest('/api/panels/location');
  }

  private async updateLocationSettings(args: { settings: any }): Promise<any> {
    await this.makeApiRequest('/api/panels/location', 'PUT', args.settings);
    return 'Location settings updated successfully.';
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
    await this.makeApiRequest(`/api/quickApp/${args.quickAppId}/restart`, 'POST');
    return `QuickApp ${args.quickAppId} restarted successfully.`;
  }

  // System Context & Intelligence Methods
  private async getSystemContext(args: any): Promise<any> {
    try {
      // Gather comprehensive system information
      const [info, devices, rooms, scenes, variables, weather] = await Promise.all([
        this.makeApiRequest('/api/settings/info').catch(() => null),
        this.makeApiRequest('/api/devices').catch(() => []),
        this.makeApiRequest('/api/rooms').catch(() => []),
        this.makeApiRequest('/api/scenes').catch(() => []),
        this.makeApiRequest('/api/globalVariables').catch(() => []),
        this.makeApiRequest('/api/weather').catch(() => null)
      ]);

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
        key_variables: variables.slice(0, 10)
      };
    } catch (error) {
      throw new Error(`Failed to get system context: ${error}`);
    }
  }

  private async getDeviceRelationships(args: any): Promise<any> {
    try {
      const deviceId = args.deviceId;
      const [devices, rooms, scenes] = await Promise.all([
        this.makeApiRequest('/api/devices').catch(() => []),
        this.makeApiRequest('/api/rooms').catch(() => []),
        this.makeApiRequest('/api/scenes').catch(() => [])
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
      const [devices, scenes, variables] = await Promise.all([
        this.makeApiRequest('/api/devices').catch(() => []),
        this.makeApiRequest('/api/scenes').catch(() => []),
        this.makeApiRequest('/api/globalVariables').catch(() => [])
      ]);

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
        automation_potential: suggestions.length > 0 ? 'High' : 'Medium'
      };
    } catch (error) {
      throw new Error(`Failed to get automation suggestions: ${error}`);
    }
  }

  private async explainDeviceCapabilities(args: any): Promise<any> {
    try {
      const deviceId = args.deviceId;
      const devices = await this.makeApiRequest('/api/devices').catch(() => []);

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
    return await this.makeApiRequest(`/api/quickApp/${deviceId}/files`, 'POST', fileData);
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
    
    return await this.makeApiRequest(
      `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`, 
      'PUT', 
      updateData
    );
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
    return await this.makeApiRequest(`/api/quickApp/${deviceId}/files`, 'PUT', filesData);
  }

  private async deleteQuickAppFile(args: { deviceId: number; fileName: string }): Promise<any> {
    const { deviceId, fileName } = args;
    return await this.makeApiRequest(
      `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`, 
      'DELETE'
    );
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
    
    let url = `/api/plugins/callUIEvent?deviceID=${deviceId}&elementName=${encodeURIComponent(elementName)}&eventType=${eventType}`;
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

  private async deletePlugin(args: { type: string }): Promise<any> {
    const { type } = args;
    const url = `/api/plugins/installed?type=${encodeURIComponent(type)}`;
    return await this.makeApiRequest(url, 'DELETE');
  }

  private sendResponse(response: MCPResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  private sendError(id: string | number | undefined, code: number, message: string, data?: any): void {
    this.sendResponse({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    });
  }
}

// Start the server
const server = new HC3MCPServer();
