// Plugin-management tools. Mostly thin wrappers around /api/plugins/*
// endpoints. The notable one is delete_plugin, which BULK-uninstalls
// every device of a given plugin type — and refuses unless
// allow_bulk=true when more than one device of the type exists.

import { ToolModule } from './registry';

export const plugins: ToolModule = {
  schemas: [
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
  ],

  handlers: {
    async get_plugins(hc3, _args: any): Promise<any> {
      return await hc3.request('/api/plugins');
    },

    async get_installed_plugins(hc3, _args: any): Promise<any> {
      return await hc3.request('/api/plugins/installed');
    },

    async get_plugin_types(hc3, _args: { language?: string }): Promise<any> {
      // For now, we'll use the basic API request without custom headers
      // The language preference can be handled by the client
      return await hc3.request('/api/plugins/types');
    },

    async get_plugin_view(hc3, args: {
      deviceId?: number;
      pluginName?: string;
      viewType?: string;
      format?: string;
      language?: string
    }): Promise<any> {
      const { deviceId, pluginName, viewType = 'view' } = args;

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
      return await hc3.request(url);
    },

    async update_plugin_view(hc3, args: {
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
      return await hc3.request('/api/plugins/updateView', 'POST', updateData);
    },

    async call_ui_event(hc3, args: {
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

      return await hc3.request(url, 'GET');
    },

    async create_child_device(hc3, args: {
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
      return await hc3.request('/api/plugins/createChildDevice', 'POST', deviceData);
    },

    async manage_plugin_interfaces(hc3, args: {
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
      return await hc3.request('/api/plugins/interfaces', 'POST', requestData);
    },

    async restart_plugin(hc3, args: { deviceId: number }): Promise<any> {
      const { deviceId } = args;
      const requestData = { deviceId };
      return await hc3.request('/api/plugins/restart', 'POST', requestData);
    },

    async update_device_property(hc3, args: {
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
      return await hc3.request('/api/plugins/updateProperty', 'POST', requestData);
    },

    async publish_plugin_event(hc3, args: {
      eventType: string;
      source?: number;
      data?: any
    }): Promise<any> {
      const { eventType, source, data = {} } = args;

      const eventData: any = { type: eventType };

      if (source !== undefined) {
        eventData.source = source;
      }

      if (data && Object.keys(data).length > 0) {
        eventData.data = data;
      }

      return await hc3.request('/api/plugins/publishEvent', 'POST', eventData);
    },

    async get_ip_cameras(hc3, _args: any): Promise<any> {
      return await hc3.request('/api/plugins/ipCameras');
    },

    async install_plugin(hc3, args: { type: string }): Promise<any> {
      const { type } = args;
      const url = `/api/plugins/installed?type=${encodeURIComponent(type)}`;
      return await hc3.request(url, 'POST');
    },

    async delete_plugin(hc3, args: { type: string; allow_bulk?: boolean }): Promise<any> {
      const { type } = args;
      if (!type) throw new Error('delete_plugin requires type.');
      const devices: any[] = await hc3.request(`/api/devices?type=${encodeURIComponent(type)}`);
      if (devices.length > 1 && !args.allow_bulk) {
        throw new Error(
          `delete_plugin would uninstall ${devices.length} devices of type '${type}' (ids: ${devices.map(d => d.id).slice(0, 10).join(', ')}${devices.length > 10 ? ', …' : ''}). ` +
          `Pass allow_bulk=true to proceed, or use delete_device(deviceId) for a single-device removal.`
        );
      }
      const url = `/api/plugins/installed?type=${encodeURIComponent(type)}`;
      const res = await hc3.request(url, 'DELETE');
      return {
        type,
        devicesAffected: devices.length,
        deviceIds: devices.map(d => d.id),
        raw: res
      };
    },
  },
};
