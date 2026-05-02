// QuickApp tools — both the core operations (get/restart/create/types,
// variable get/set) and the file-management subgroup (list/get/create/
// update/delete/export/import). 15 tools total.
//
// Two named schema arrays exposed because the original tools/list
// ordering scatters QA tools across two non-adjacent positions: a
// 3-tool "core" cluster early in the array, and a 12-tool extended
// cluster later (after the "System Context & Intelligence" group).
// To preserve byte-equivalent tools/list ordering, the server spreads
// these two arrays at their respective positions; the registry merges
// all 15 handlers via the single ToolModule export.
//
// Behavioural notes preserved verbatim from the originals:
// - restart_quickapp wraps /api/plugins/restart (HC3 5.x has no
//   /api/quickApp/{id}/restart).
// - create/update/update_multiple/_quickapp_file all post-verify by
//   refetching content and asserting byte equality (HC3 has known
//   silent-write paths on QA file edits).
// - set_quickapp_variable reads the declared variable type, coerces
//   the submitted value to match, full-array-replaces the
//   quickAppVariables array, then verifies value AND type after
//   write.
// - import_quickapp is currently a stub that throws — file upload
//   over MCP needs FormData multipart support that hasn't been wired
//   up.

import { ToolModule } from './registry';
import { MCPTool } from '../types';

export const quickappsCoreSchemas: MCPTool[] = [
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
];

export const quickappsExtSchemas: MCPTool[] = [
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
            fileName: {
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
          required: ["deviceId", "fileName"]
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
                  fileName: {
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
                required: ["fileName", "content"]
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
];

export const quickapps: ToolModule = {
  schemas: [...quickappsCoreSchemas, ...quickappsExtSchemas],

  handlers: {
    async get_quickapps(hc3): Promise<any> {
      // /api/quickApp/ returns HTTP 501 on current firmware (5.20x) — same
      // dead-endpoint cluster as /api/info, /api/firmware, /api/energy.
      // Enumerate via /api/devices?interface=quickApp instead. Returned shape
      // is the canonical /api/devices record, with QAs identified by the
      // "quickApp" interface entry.
      return await hc3.request('/api/devices?interface=quickApp');
    },

    async get_quickapp(hc3, args: { quickAppId: number }): Promise<any> {
      // /api/quickApp/{id} returns HTTP 501 on current firmware (5.20x).
      // Use /api/devices/{id} which carries the same data; sanity-check the
      // device is actually a QuickApp before returning so callers don't get
      // a silent non-QA device back when they pass a bad id.
      const dev = await hc3.request(`/api/devices/${args.quickAppId}`) as any;
      const isQA = Array.isArray(dev?.interfaces) && dev.interfaces.includes('quickApp');
      if (!isQA) {
        throw new Error(
          `Device ${args.quickAppId} exists but is not a QuickApp (its interfaces do not include 'quickApp'). Use get_quickapps to list QuickApp devices, or get_device_info if you wanted a non-QA device record.`,
        );
      }
      return dev;
    },

    async restart_quickapp(hc3, args: { quickAppId: number }): Promise<any> {
      // /api/quickApp/{id}/restart does not exist on HC3 5.x — the UI uses
      // /api/plugins/restart with {deviceId} for both QAs and plugin devices.
      // restart_quickapp is now a thin alias over the same endpoint as
      // restart_plugin (different parameter name preserved for callers).
      await hc3.request('/api/plugins/restart', 'POST', { deviceId: args.quickAppId });
      return `QuickApp ${args.quickAppId} restarted successfully.`;
    },

    async list_quickapp_files(hc3, args: { deviceId: number }): Promise<any> {
      const { deviceId } = args;
      return await hc3.request(`/api/quickApp/${deviceId}/files`);
    },

    async get_quickapp_file(hc3, args: { deviceId: number; fileName: string }): Promise<any> {
      const { deviceId, fileName } = args;
      return await hc3.request(`/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`);
    },

    async create_quickapp_file(hc3, args: {
      deviceId: number;
      fileName: string;
      type?: string;
      content?: string;
      isOpen?: boolean
    }): Promise<any> {
      const { deviceId, fileName, type = 'lua', content = '', isOpen = false } = args;
      // HC3's POST body still uses `name` for the file's own name in its
      // canonical wire shape. The MCP arg is fileName; the wire body remaps.
      const fileData = {
        name: fileName,
        type,
        content,
        isOpen,
        isMain: false
      };
      const postResult = await hc3.request(`/api/quickApp/${deviceId}/files`, 'POST', fileData);

      const after = await hc3.request(
        `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`
      );
      if (!after) {
        throw new Error(`create_quickapp_file: file '${fileName}' not present after POST on device ${deviceId}.`);
      }
      if (after.content !== content) {
        throw new Error(
          `create_quickapp_file: content mismatch after POST on device ${deviceId}, file '${fileName}'. ` +
          `Submitted ${content.length} chars, HC3 stored ${(after.content ?? '').length} chars.`
        );
      }

      return postResult;
    },

    async update_quickapp_file(hc3, args: {
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

      const putResult = await hc3.request(
        `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`,
        'PUT',
        updateData
      );

      if (content !== undefined) {
        const after = await hc3.request(
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
    },

    async update_multiple_quickapp_files(hc3, args: {
      deviceId: number;
      files: Array<{ fileName: string; content: string; type?: string; isOpen?: boolean }>
    }): Promise<any> {
      const { deviceId, files } = args;
      const existing = await hc3.request(`/api/quickApp/${deviceId}/files`);
      const isMainByName = new Map<string, boolean>(
        (existing ?? []).map((f: any) => [f.name, !!f.isMain])
      );
      // The MCP arg uses fileName; HC3's wire shape uses `name` for the file's
      // own name. Remap on the way out.
      const filesData = files.map(file => ({
        name: file.fileName,
        content: file.content,
        type: file.type || 'lua',
        isOpen: file.isOpen || false,
        isMain: isMainByName.get(file.fileName) ?? false
      }));
      const putResult = await hc3.request(`/api/quickApp/${deviceId}/files`, 'PUT', filesData);

      const stored = await Promise.all(
        files.map(f =>
          hc3.request(`/api/quickApp/${deviceId}/files/${encodeURIComponent(f.fileName)}`)
            .then((v: any) => ({ fileName: f.fileName, content: v?.content ?? null }))
            .catch(() => ({ fileName: f.fileName, content: null }))
        )
      );
      const storedByName = new Map(stored.map(s => [s.fileName, s.content]));
      const mismatches: string[] = [];
      for (const submitted of files) {
        const c = storedByName.get(submitted.fileName);
        if (c === null || c === undefined) {
          mismatches.push(`  - '${submitted.fileName}': missing after PUT (not created or fetch failed)`);
        } else if (c !== submitted.content) {
          mismatches.push(
            `  - '${submitted.fileName}': content mismatch (submitted ${submitted.content.length} chars, stored ${c.length} chars)`
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
    },

    async delete_quickapp_file(hc3, args: { deviceId: number; fileName: string }): Promise<any> {
      const { deviceId, fileName } = args;
      return await hc3.request(
        `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`,
        'DELETE'
      );
    },

    async get_quickapp_variable(hc3, args: { deviceId: number; name: string }): Promise<any> {
      const { deviceId, name } = args;
      const device = await hc3.request(`/api/devices/${deviceId}`);
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
    },

    async set_quickapp_variable(hc3, args: {
      deviceId: number;
      name: string;
      value: string | number | boolean;
    }): Promise<any> {
      const { deviceId, name, value } = args;

      const device = await hc3.request(`/api/devices/${deviceId}`);
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

      await hc3.request(`/api/devices/${deviceId}`, 'PUT', {
        properties: { quickAppVariables: newVars }
      });

      const after = await hc3.request(`/api/devices/${deviceId}`);
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
    },

    async export_quickapp(hc3, args: {
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
        return await hc3.request(`/api/quickApp/export/${deviceId}`, 'POST', exportData);
      } else {
        // Export as open source
        return await hc3.request(`/api/quickApp/export/${deviceId}`, 'POST', { encrypted: false });
      }
    },

    async create_quickapp(hc3, args: {
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

      const created: any = await hc3.request('/api/quickApp', 'POST', body);
      const newId = created?.id;
      if (typeof newId !== 'number') {
        throw new Error(
          `create_quickapp: HC3 accepted the POST but did not return a device id. Raw response: ${JSON.stringify(created).slice(0, 400)}`
        );
      }

      const after: any = await hc3.request(`/api/devices/${newId}`);
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
    },

    async get_quickapp_available_types(hc3): Promise<any> {
      return await hc3.request('/api/quickApp/availableTypes');
    },

    async import_quickapp(_hc3, _args: { filePath: string; roomId?: number }): Promise<any> {
      // Note: This is a simplified implementation. In a real scenario, you would need to:
      // 1. Read the file from the filesystem
      // 2. Create a FormData object with the file
      // 3. Send it as multipart/form-data

      throw new Error('QuickApp import requires file upload functionality that is not yet implemented. Use the Fibaro web interface for imports.');
    },
  },
};
