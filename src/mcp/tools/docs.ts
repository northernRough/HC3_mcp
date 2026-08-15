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
        description: 'HC3 gateway configuration reference: network, users, rooms, Z-Wave inclusion and settings, time, location, VoIP. Background for administering the controller rather than programming it — for writing Lua, use get_hc3_lua_scenes_guide or get_hc3_quickapp_programming_guide instead.',
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
        description: 'HC3 QuickApp programming: Lua syntax, QuickApp methods, HTTP/TCP/UDP/MQTT clients, child devices.\n\n**Call this before writing or editing QuickApp Lua**, and read `gotchas` first even if you know Lua. That topic carries platform behaviour that is not guessable from the language and that the official docs omit or state wrongly — the `quickApp` global reporting as `userdata` with a null-type tostring while being fully usable, `getVariable` returning "" for a missing variable indistinguishably from an empty one, coroutines being unavailable (so any wrapper that fakes synchronous HTTP with `coroutine.yield` cannot work), external variable writes restarting the QuickApp once per call, and the real `createChildDevice` signature. Every item was observed on a live gateway.\n\n**Building a tile? Read `ui` first.** QuickApp UIs fail by rendering correctly, accepting input and doing nothing at all, with no error anywhere: one malformed `select` serves an EMPTY view, `create_quickapp` discards the callbacks you supply and rewrites the eventType too, and — measured — a real tap always dispatches `UIAction` positionally while `call_ui_event` dispatches the registered name with an event table, so a tile can test green through this MCP and be dead under a finger.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic (optional). Start with "gotchas" — the platform behaviours that produce silent bugs. Read "ui" BEFORE building any tile: a QuickApp UI fails by rendering, accepting input and doing nothing, with no error in any layer. Then basic, methods, http, tcp, udp, websocket, mqtt, child_devices.',
              enum: ['gotchas', 'ui', 'basic', 'methods', 'http', 'tcp', 'udp', 'websocket', 'mqtt', 'child_devices', 'all']
            }
          }
        }
      },
      {
        name: 'get_hc3_lua_scenes_guide',
        description: 'HC3 Lua scenes: the execution model, conditions, triggers, actions and the scene API.\n\n**Call this before writing or editing scene Lua**, and read `execution_model` first. Most scene advice in circulation is HC2 advice or one of two specific myths, and the corrections change what you write: a scene runs ONE instance governed by `restart` (`maxRunningInstances` is vestigial, never write it); **a firing `fibaro.setTimeout` does NOT restart the scene** — tested on two scratch scenes over three runs, the closure capture survived and the top of the scene ran exactly once, so the defensive re-read-everything pattern is optional rather than mandatory; `fibaro.setTimeout` is delay-first everywhere including inside QuickApps; a manual run is `type == "user" AND property == "execute"`, both halves; and scene variables are reported to have no REST API, which is the reason to put inspectable state in a QuickApp instead.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic (optional). Start with "execution_model" — how the engine actually runs a scene, and which widely repeated claims are false. Then conditions, triggers, actions, examples, api.',
              enum: ['execution_model', 'conditions', 'triggers', 'actions', 'examples', 'api', 'all']
            }
          }
        }
      },
      {
        name: 'get_hc3_programming_examples',
        description: 'Practical HC3 code, by category.\n\n`patterns` is the one to reach for when building something rather than looking up a scenario: self-contained, gateway-tested components that lift straight into a scene or QuickApp — trigger parsing with a manual-run guard, a scene-variable state store with safe init, structured logging enriched with room names, a restart-safe scheduler for delays that must survive a reboot, window gating, a daily computation cache, a polling loop with backoff and jitter, a callback-based HTTP wrapper (coroutines do not work on HC3), a child-device factory with the persisted id map HC3 forces on you, rolling averages, a default scene skeleton, and a QuickApp UI handler that survives both of HC3\'s dispatch shapes (a real tap calls `UIAction` positionally; `call_ui_event` calls the registered callback with an event table, so a handler written against either alone is half-dead). The other categories are scenario snippets.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Category (optional). Use "patterns" for reusable building blocks; the rest are scenario snippets: lighting, security, climate, scenes, devices, mqtt, tcp.',
              enum: ['patterns', 'lighting', 'security', 'climate', 'scenes', 'devices', 'mqtt', 'tcp', 'all']
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
