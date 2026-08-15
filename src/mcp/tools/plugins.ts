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
        description: "Trigger a UI event on a QuickApp interface element (button, slider, switch, select, …), as though a user had touched it — but NOT by the same path a real touch takes; see the table below, and get_hc3_quickapp_programming_guide({topic:\"ui\"}) for the whole UI lifecycle.\n\n**HC3's endpoint returns nothing** — no acknowledgement, no echo, no indication that a callback was even bound to that element. That is the silent-success shape this server exists to close, and it matters more here than elsewhere because this is the tool people reach for *as* a verification step. So before dispatching, this tool reads the device's `uiCallbacks` and reports what the element is bound to as `boundCallback`. A null there means HC3 has no binding for that (elementName, eventType) pair, and the event will very likely go nowhere — it is reported, not refused, because HC3 may still route it to a generic handler.\n\n**Confirming it actually ran, without instrumenting the QuickApp.** HC3 emits an undocumented trace-level line tagged with the QA, `UIEvent: {\"values\":[…],\"deviceId\":N,\"eventType\":\"…\",\"elementName\":\"…\"}`, immediately before dispatch. Verified on 5.210.12. Call get_debug_messages(type=\"trace\") after this and look for it — that confirms the UI event path end to end with no log line planted in the QuickApp.\n\n**THIS TOOL DOES NOT DISPATCH THE WAY A FINGER DOES, and the difference will mislead you.** Measured on 5.210.12 by `scripts/probe-uicallbacks.mjs` (twelve cells, then the same elements tapped in the iOS app):\n\n| | this tool | a real tap |\n|---|---|---|\n| handler called | the callback registered in `uiCallbacks` | **always `UIAction`**, whatever is registered |\n| arguments | ONE table `{eventType, elementName, values, deviceId}` | **positional**: `(eventType, elementName)` for a button, `(eventType, elementName, values)` for a select |\n| trace emitted | `UIEvent:` | `onAction:` |\n\nBoth axes differ, in the same direction: this tool is the more generous one. So it will show a named callback working when **no user tap will ever reach it**, and it will hand your handler a table when a tap hands it strings. A QuickApp written and verified through this tool alone can be completely dead in the app. Verify UI wiring by tapping, or write a handler that accepts both shapes (`if type(arg1) == \"table\"` … else positional), which is what a QuickApp on this gateway does in production.\n\nUse this tool to prove the event path is live, to fire an element while nobody is home, and to read the `UIEvent:` trace. Do not use it as evidence about which handler a user's tap will hit.",
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

      // Look up the binding BEFORE dispatching. HC3's endpoint returns an
      // empty body, so without this the caller cannot tell a delivered event
      // from one that fell on the floor — and this is the tool most often
      // reached for as a verification step.
      let boundCallback: any = null;
      let bindingLookupError: string | undefined;
      try {
        const device: any = await hc3.request(`/api/devices/${deviceId}`);
        const callbacks: any[] = Array.isArray(device?.properties?.uiCallbacks)
          ? device.properties.uiCallbacks
          : [];
        boundCallback = callbacks.find(
          c => c?.name === elementName && c?.eventType === eventType
        ) ?? null;
      } catch (e: any) {
        bindingLookupError = e?.message ?? String(e);
      }

      let url = `/api/plugins/callUIEvent?deviceID=${deviceId}&elementName=${encodeURIComponent(elementName)}&eventType=${encodeURIComponent(eventType)}`;
      if (value) {
        url += `&value=${encodeURIComponent(value)}`;
      }

      const raw = await hc3.request(url, 'GET');

      return {
        dispatched: { deviceId, elementName, eventType, ...(value !== undefined ? { value } : {}) },
        boundCallback,
        ...(boundCallback === null && !bindingLookupError
          ? {
              warning:
                `No uiCallbacks entry binds '${elementName}' to '${eventType}' on device ${deviceId}. ` +
                `HC3 accepts the call regardless and returns nothing, so this event may have gone nowhere. ` +
                `Check the element name and eventType against get_device_info properties.uiCallbacks.`,
            }
          : {}),
        ...(bindingLookupError ? { bindingLookupError } : {}),
        confirmWith:
          `get_debug_messages(type="trace") — HC3 logs "UIEvent: {...}" immediately before dispatch.`,
        hc3Response: raw ?? null,
      };
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
