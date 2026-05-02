// "System intelligence" tools — read-only aggregated views built on
// top of the device/room/scene/global-variable endpoints. Used by
// agents to size up the home before issuing more targeted calls.
//
// Most handlers tolerantFetch ancillary surfaces (system_info,
// weather, scenes, variables) so a single endpoint failure doesn't
// nuke the response — failed surfaces land in `_fetch_errors`.

import { ToolModule } from './registry';
import { tolerantFetch } from '../util';

export const intelligence: ToolModule = {
  schemas: [
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
  ],

  handlers: {
    async get_system_context(hc3, _args: any): Promise<any> {
      try {
        // Primary fetches (devices/rooms/scenes/variables) propagate errors so
        // HC3 unreachability surfaces instead of returning empty arrays.
        // Ancillary (info/weather) tolerated and reported via _fetch_errors.
        const [infoResult, devices, rooms, scenes, variables, weatherResult] = await Promise.all([
          tolerantFetch('system_info', hc3.request('/api/settings/info')),
          hc3.request('/api/devices'),
          hc3.request('/api/rooms'),
          hc3.request('/api/scenes'),
          hc3.request('/api/globalVariables'),
          tolerantFetch('weather', hc3.request('/api/weather'))
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
    },

    async get_device_relationships(hc3, args: any): Promise<any> {
      try {
        const deviceId = args.deviceId;
        const [devices, rooms, scenes] = await Promise.all([
          hc3.request('/api/devices'),
          hc3.request('/api/rooms'),
          hc3.request('/api/scenes')
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
    },

    async get_automation_suggestions(hc3, _args: any): Promise<any> {
      try {
        const [devices, scenesResult, variablesResult] = await Promise.all([
          hc3.request('/api/devices'),
          tolerantFetch('scenes', hc3.request('/api/scenes')),
          tolerantFetch('variables', hc3.request('/api/globalVariables'))
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
    },

    async explain_device_capabilities(hc3, args: any): Promise<any> {
      try {
        const deviceId = args.deviceId;
        const devices = await hc3.request('/api/devices');

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
    },
  },
};
