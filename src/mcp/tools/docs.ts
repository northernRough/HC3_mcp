// HC3 documentation/programming-guide tools — pure data-serving handlers
// that look up topic/category keys in the imported guide constants and
// return them under the original {title, sections|section|categories|
// category|available_topics|available_categories} shape.

import { ToolModule } from './registry';
import { configurationGuide } from '../docs/configuration';
import { programmingGuide } from '../docs/quickapp-programming';
import { scenesGuide } from '../docs/lua-scenes';
import { examples } from '../docs/programming-examples';

export const docs: ToolModule = {
  schemas: [
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
  ],

  handlers: {
    async get_hc3_configuration_guide(_hc3, args: any): Promise<any> {
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
    },

    async get_hc3_quickapp_programming_guide(_hc3, args: any): Promise<any> {
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
    },

    async get_hc3_lua_scenes_guide(_hc3, args: any): Promise<any> {
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
    },

    async get_hc3_programming_examples(_hc3, args: any): Promise<any> {
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
    },
  },
};
