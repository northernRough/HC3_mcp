// QuickApp tools — both the core operations (get/restart/create/types,
// variable get/set) and the file-management subgroup (list/get/create/
// update/patch/delete/export/import). 16 tools total.
//
// Two named schema arrays exposed because the original tools/list
// ordering scatters QA tools across two non-adjacent positions: a
// 3-tool "core" cluster early in the array, and a 13-tool extended
// cluster later (after the "System Context & Intelligence" group).
// To preserve byte-equivalent tools/list ordering, the server spreads
// these two arrays at their respective positions; the registry merges
// all 16 handlers via the single ToolModule export.
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
// - import_quickapp posts multipart/form-data to /api/quickApp/import
//   (parts: file, roomId). It accepts the .fqa as base64 so a remote
//   client can import without shell access to the server, and still
//   accepts a server-side filePath. Hand-rolled multipart, same as
//   upload_icon, because it needs raw bytes.

import { ToolModule } from './registry';
import { MCPTool } from '../types';
import { readFile } from 'node:fs/promises';
import { applyEdits, unifiedDiff, excerpt, wantsExcerpt, PatchEdit } from '../patch';
import { luaLint, luaWarningSummary } from '../lua';
import { contentHash } from '../util';

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
        description: "Get a specific QuickApp file. Returns the whole content by default, plus `contentHash` (md5 of what HC3 stored) — pass that hash to patch_quickapp_file as expectedHash to make the write refuse if anything edited the file in between.\n\n**Reading part of a file.** A 1,500-line engine costs its whole length to look at one function. Supply startLine/endLine, or `contains` to get every matching line with surrounding context, and the response carries a line-numbered excerpt instead of the body. Those line numbers make the excerpt directly quotable back into a patch `old`. The response always reports totalLines so you know what you did not see.",
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
            },
            startLine: {
              type: "number",
              description: "1-indexed first line to return. With endLine, returns just that range."
            },
            endLine: {
              type: "number",
              description: "1-indexed last line to return (inclusive)."
            },
            contains: {
              type: "string",
              description: "Return only lines containing this literal substring, with context either side. Case-sensitive, not a regex. Composes with startLine/endLine, which narrow the search first."
            },
            contextLines: {
              type: "number",
              description: "Lines of context either side of a `contains` hit. Default 3."
            },
            maxLines: {
              type: "number",
              description: "Cap on returned lines so a loose filter cannot return the whole file. Default 200."
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
        name: "patch_quickapp_file",
        description: "Change part of a QuickApp file by supplying only the text to replace, instead of reproducing the whole file as update_quickapp_file requires. Prefer this for any edit to a file you are not creating from scratch: on a 58 KB engine a one-line fix costs ~16k tokens through update_quickapp_file and ~200 bytes through this tool.\n\n**Each `old` must match exactly `count` times (default 1), or NOTHING is written** — not the failing edit and not the edits before it. This is the point of the tool: a complete file is always a structurally valid thing to write, so a whole-file PUT cannot tell a real change from a truncated paste or a stale copy, whereas an edit that does not fit its file is self-evidently wrong and gets refused. Zero matches usually means your copy is stale or the whitespace differs; too many means `old` is not unique, so extend it with surrounding lines (or set count deliberately to change them all).\n\n`old` is literal text, never a regex or a line number, and must match byte for byte including indentation. Set `new` to an empty string to delete the matched text. Edits apply in order, each against the result of the previous one.\n\nAtomic: edits are applied to an in-memory copy and the file is written once via the same PUT update_quickapp_file uses, then re-fetched and compared byte for byte. Returns a unified diff of what changed plus before/after sizes and an md5 of the stored result — so you can confirm the change landed where you meant without re-reading the file.\n\nSet dryRun=true to get that diff with no write at all: the safe way to confirm an edit before touching a QuickApp that is controlling hardware.\n\nThe patched result is checked for gross Lua damage (unbalanced brackets, unterminated strings, missing `end`) and any finding is reported as `luaWarnings`. It is a heuristic, not a parser, so it **warns and still writes** — a false refusal on a device holding valves open would be worse than the gap. No warnings does not mean it compiles.\n\nTo change several files, prefer one update_multiple_quickapp_files call over several patches — each external write goes through HC3's file endpoint and QuickApps are known to restart on external writes, so N calls risk N restarts.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            fileName: {
              type: "string",
              description: "Name of the file to patch (from list_quickapp_files)"
            },
            edits: {
              type: "array",
              description: "Edits to apply, in order. At least one.",
              items: {
                type: "object",
                properties: {
                  old: {
                    type: "string",
                    description: "Exact existing text to replace. Literal, not a pattern; must match byte for byte including indentation. Cannot be empty — to insert, anchor on a nearby line and include it in both old and new."
                  },
                  new: {
                    type: "string",
                    description: "Replacement text. Empty string deletes the matched text."
                  },
                  count: {
                    type: "number",
                    description: "Exact number of occurrences expected. Default 1. Any other number of matches aborts the whole patch before anything is written."
                  }
                },
                required: ["old", "new"]
              }
            },
            expectedHash: {
              type: "string",
              description: "The contentHash from get_quickapp_file. If supplied and the file no longer hashes to it, the patch is refused without writing — the file changed since you read it (web UI, mobile app, another MCP session, or the QuickApp's own Lua; there is no single writer). Omit to skip the check."
            },
            dryRun: {
              type: "boolean",
              description: "Compute and return the diff without writing anything. Default false."
            }
          },
          required: ["deviceId", "fileName", "edits"]
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
        description: "Set a QuickApp variable via PUT /api/devices/{id} with the properties.quickAppVariables wrapper (the HC3 UI's save pattern). Reads the declared type first, writes with type preserved (avoids HC3's numeric-string coercion quirk), then verifies post-write state and throws on mismatch rather than silently succeeding. Variable must already exist; use create_quickapp_variable to add a new variable. Caveat: numeric-looking string values (e.g. \"3.0\") lose their exact lexical form crossing the MCP JSON boundary — the harness parses the input as a number, then this tool stringifies it (String(3.0) === \"3\"). If you need a specific numeric-string literal preserved verbatim, write it via modify_device with a full properties.quickAppVariables array (include every existing variable — HC3 does a full-array replace on PUT, so any variable omitted from the submission will be destroyed). **Writing a QuickApp variable from outside RESTARTS the QuickApp** (verified on 5.210.12: the QA bounced within 4s). It restarts once per call, so creating eight variables in sequence restarts the QA eight times, and a write issued after another restarting call may never execute — order them accordingly. To push several FILES use update_multiple_quickapp_files, which restarts once rather than once per file.",
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
        name: "create_quickapp_variable",
        description: "Create a new QuickApp variable via PUT /api/devices/{id} with the properties.quickAppVariables wrapper (full-array replace — reads the current list, appends, writes back). Refuses if the name already exists (use set_quickapp_variable to update). Optional varType lets the caller choose the stored type; if omitted, type is inferred from the JS type of value: boolean → 'bool', number → 'number' (never 'integer' by inference — pass varType:'integer' explicitly), string → 'string'. Post-create verifies by refetching and asserting name, value, and type all match the intended state. **Writing a QuickApp variable from outside RESTARTS the QuickApp** (verified on 5.210.12: the QA bounced within 4s). It restarts once per call, so creating eight variables in sequence restarts the QA eight times, and a write issued after another restarting call may never execute — order them accordingly. To push several FILES use update_multiple_quickapp_files, which restarts once rather than once per file.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            name: {
              type: "string",
              description: "Variable name. Must not already exist on the device."
            },
            value: {
              type: ["string", "number", "boolean"],
              description: "Initial value. Coerced to match varType (or the inferred type) before write."
            },
            varType: {
              type: "string",
              enum: ["string", "number", "integer", "bool"],
              description: "Optional. Declared HC3 type for the new variable. Defaults to the JS type of value (bool/number/string). Pass 'integer' explicitly if you want integer semantics — never inferred."
            }
          },
          required: ["deviceId", "name", "value"]
        }
      },
      {
        name: "delete_quickapp_variable",
        description: "Delete a QuickApp variable by name via PUT /api/devices/{id} with the properties.quickAppVariables wrapper (full-array replace — reads the current list, filters out the named entry, writes back). Refuses if the variable does not exist (typo / already-deleted protection). Returns the deleted entry's previous {type, value} as a recovery trail. Post-delete verifies by refetch (expects the name to be absent). **Writing a QuickApp variable from outside RESTARTS the QuickApp** (verified on 5.210.12: the QA bounced within 4s). It restarts once per call, so creating eight variables in sequence restarts the QA eight times, and a write issued after another restarting call may never execute — order them accordingly. To push several FILES use update_multiple_quickapp_files, which restarts once rather than once per file.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: {
              type: "number",
              description: "QuickApp device ID"
            },
            name: {
              type: "string",
              description: "Variable name. Must exist on the device."
            }
          },
          required: ["deviceId", "name"]
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
        description: "Import a QuickApp from a .fqa file via POST /api/quickApp/import (multipart/form-data with file + roomId). Returns the created device, verified by refetching it.\n\nSupply the file **either** as `base64` (the .fqa bytes, no data URL prefix) **or** as `filePath` — exactly one. Prefer `base64`: `filePath` is resolved on the machine running this MCP **server**, not the machine running the client, so when the server is remote (e.g. reached over a tunnel) a path to a local file on your own machine will not resolve.\n\nThe .fqa is JSON; it is parsed and checked for the expected `name`/`type` keys before posting, so a truncated or mis-encoded payload is caught here rather than surfacing as HC3's bare \"Cannot import quick app file\". HC3 returns 403 for a .fqa that was encrypted for a different gateway — those cannot be imported anywhere but their origin controller.",
        inputSchema: {
          type: "object",
          properties: {
            base64: {
              type: "string",
              description: "The .fqa file content, base64-encoded (no data URL prefix). Use this when driving a remote server. Mutually exclusive with filePath."
            },
            filePath: {
              type: "string",
              description: "Path to the .fqa file, resolved SERVER-SIDE (on the host running this MCP server, not the client). Mutually exclusive with base64."
            },
            fileName: {
              type: "string",
              description: "Optional filename to send in the multipart part. Defaults to the filePath basename, or \"import.fqa\" for base64 uploads. HC3 takes the QuickApp name from the file content, not this."
            },
            roomId: {
              type: "number",
              description: "Room ID where the QuickApp should be created. Defaults to the Default Room if omitted."
            }
          }
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
              description: "Optional map of initial device properties (e.g. quickAppVariables, icon, deviceRole). CAVEAT (VERIFIED on firmware 5.210.12): `uiCallbacks` supplied here is **discarded**. HC3 regenerates the table from the view at creation time — a supplied {name:'modeSelector', eventType:'onToggled', callback:'modeSelection'} comes back as {name:'modeSelector', eventType:'onReleased', callback:'uimodeSelectorOnReleased'}. The layout renders correctly and only the callbacks are wrong, so it is easy to miss. Write the intended callbacks back with a follow-up modify_device after creation."
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

    async get_quickapp_file(hc3, args: {
      deviceId: number;
      fileName: string;
      startLine?: number;
      endLine?: number;
      contains?: string;
      contextLines?: number;
      maxLines?: number;
    }): Promise<any> {
      const { deviceId, fileName } = args;
      const file: any = await hc3.request(
        `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`
      );
      if (typeof file?.content !== 'string') return file;

      const hash = contentHash(file.content);
      if (!wantsExcerpt(args)) {
        return { ...file, contentHash: hash };
      }

      const { content, ...meta } = file as Record<string, any>;
      const ex = excerpt(content, args);
      return {
        ...meta,
        contentHash: hash,
        contentOmitted: true,
        contentLength: content.length,
        ...ex,
      };
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

    async patch_quickapp_file(hc3, args: {
      deviceId: number;
      fileName: string;
      edits: PatchEdit[];
      expectedHash?: string;
      dryRun?: boolean;
    }): Promise<any> {
      const { deviceId, fileName, edits, expectedHash, dryRun } = args ?? ({} as any);
      if (typeof deviceId !== 'number') {
        throw new Error('patch_quickapp_file requires a numeric deviceId.');
      }
      if (typeof fileName !== 'string' || fileName === '') {
        throw new Error('patch_quickapp_file requires a fileName (see list_quickapp_files).');
      }

      const path = `/api/quickApp/${deviceId}/files/${encodeURIComponent(fileName)}`;
      const file: any = await hc3.request(path);
      const before: unknown = file?.content;
      if (typeof before !== 'string') {
        throw new Error(
          `patch_quickapp_file: file '${fileName}' on device ${deviceId} returned no string content ` +
          `(got ${before === undefined ? 'undefined' : typeof before}). ` +
          `Confirm the file name with list_quickapp_files.`
        );
      }

      const hashBefore = contentHash(before)!;
      if (expectedHash !== undefined && expectedHash !== hashBefore) {
        throw new Error(
          `patch_quickapp_file refused: file '${fileName}' on device ${deviceId} has changed since you read it. ` +
          `Expected md5 ${expectedHash}, found ${hashBefore}. Nothing was written. ` +
          `Re-read the file (get_quickapp_file) and rebuild the edits against the current content — ` +
          `a QuickApp file can be edited from the web UI, the mobile app, another MCP session, or the QA's own Lua.`
        );
      }

      // Throws before any write if an edit does not fit. Nothing below this
      // line runs on a mismatch, so a refused patch leaves the device alone.
      const { content: after, applied } = applyEdits(before, edits, 'patch_quickapp_file');
      const luaWarnings = luaWarningSummary(luaLint(after));

      const diff = unifiedDiff(before, after, {
        fromLabel: `${fileName} (device ${deviceId}, before)`,
        toLabel: `${fileName} (device ${deviceId}, after)`,
      });

      if (dryRun === true) {
        return {
          target: `quickapp:${deviceId}/${fileName}`,
          dryRun: true,
          written: false,
          editsMatched: applied.length,
          bytesBefore: before.length,
          bytesAfter: after.length,
          hashBefore,
          hashWouldBe: contentHash(after),
          ...(luaWarnings ? { luaWarnings } : {}),
          diff,
        };
      }

      await hc3.request(path, 'PUT', { content: after });

      // Same post-write verify as update_quickapp_file: HC3 has silent-write
      // paths on QA file edits, so a PUT that did not throw proves nothing.
      const stored: any = await hc3.request(path);
      if (stored?.content !== after) {
        throw new Error(
          `patch_quickapp_file: content mismatch after PUT on device ${deviceId}, file '${fileName}'. ` +
          `Submitted ${after.length} chars, HC3 stored ${(stored?.content ?? '').length} chars. ` +
          `The write was silently altered or dropped — re-fetch the file before patching again, ` +
          `as it may now hold a partially applied version.`
        );
      }

      return {
        target: `quickapp:${deviceId}/${fileName}`,
        written: true,
        editsApplied: applied.length,
        occurrencesReplaced: applied.reduce((n, e) => n + e.occurrences, 0),
        bytesBefore: before.length,
        bytesAfter: after.length,
        hashBefore,
        hashAfter: contentHash(stored.content),
        ...(luaWarnings ? { luaWarnings } : {}),
        diff,
      };
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
          `Known variables: ${known}. Use create_quickapp_variable to add a new variable.`
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

    async create_quickapp_variable(hc3, args: {
      deviceId: number;
      name: string;
      value: string | number | boolean;
      varType?: 'string' | 'number' | 'integer' | 'bool';
    }): Promise<any> {
      const { deviceId, name, value, varType } = args;

      if (!name || typeof name !== 'string') {
        throw new Error('create_quickapp_variable requires a non-empty name.');
      }

      const device = await hc3.request(`/api/devices/${deviceId}`);
      const vars: any[] = device?.properties?.quickAppVariables ?? [];
      if (vars.find(v => v.name === name)) {
        throw new Error(
          `QuickApp variable '${name}' already exists on device ${deviceId}. ` +
          `Use set_quickapp_variable to update its value.`
        );
      }

      let intendedType: string;
      if (varType) {
        intendedType = varType;
      } else if (typeof value === 'boolean') {
        intendedType = 'bool';
      } else if (typeof value === 'number') {
        intendedType = 'number';
      } else {
        intendedType = 'string';
      }

      let coercedValue: any;
      if (intendedType === 'string') {
        coercedValue = String(value);
      } else if (intendedType === 'number' || intendedType === 'integer') {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
          throw new Error(
            `Cannot create numeric variable '${name}' with non-numeric value ${JSON.stringify(value)}.`
          );
        }
        coercedValue = intendedType === 'integer' ? Math.trunc(n) : n;
      } else if (intendedType === 'bool' || intendedType === 'boolean') {
        if (typeof value === 'boolean') coercedValue = value;
        else if (value === 'true' || value === 1) coercedValue = true;
        else if (value === 'false' || value === 0) coercedValue = false;
        else {
          throw new Error(
            `Cannot create boolean variable '${name}' with value ${JSON.stringify(value)}.`
          );
        }
      } else {
        coercedValue = value;
      }

      const newEntry = { name, value: coercedValue, type: intendedType };
      const newVars = [...vars, newEntry];

      await hc3.request(`/api/devices/${deviceId}`, 'PUT', {
        properties: { quickAppVariables: newVars }
      });

      const after = await hc3.request(`/api/devices/${deviceId}`);
      const afterVars: any[] = after?.properties?.quickAppVariables ?? [];
      const afterVar = afterVars.find(v => v.name === name);
      if (!afterVar) {
        throw new Error(
          `Post-create verification failed: variable '${name}' missing after PUT on device ${deviceId}.`
        );
      }
      if (String(afterVar.value) !== String(coercedValue)) {
        throw new Error(
          `Post-create value mismatch for '${name}' on device ${deviceId}: ` +
          `requested ${JSON.stringify(coercedValue)}, HC3 stored ${JSON.stringify(afterVar.value)}.`
        );
      }
      if (afterVar.type !== intendedType) {
        throw new Error(
          `Post-create type mismatch for '${name}' on device ${deviceId}: ` +
          `requested '${intendedType}', HC3 stored '${afterVar.type}'.`
        );
      }

      return {
        deviceId,
        name,
        created: { type: afterVar.type, value: afterVar.value }
      };
    },

    async delete_quickapp_variable(hc3, args: {
      deviceId: number;
      name: string;
    }): Promise<any> {
      const { deviceId, name } = args;

      const device = await hc3.request(`/api/devices/${deviceId}`);
      const vars: any[] = device?.properties?.quickAppVariables ?? [];
      const existing = vars.find(v => v.name === name);
      if (!existing) {
        const known = vars.map(v => v.name).join(', ') || '(none)';
        throw new Error(
          `QuickApp variable '${name}' does not exist on device ${deviceId}. ` +
          `Known variables: ${known}.`
        );
      }

      const newVars = vars.filter(v => v.name !== name);

      await hc3.request(`/api/devices/${deviceId}`, 'PUT', {
        properties: { quickAppVariables: newVars }
      });

      const after = await hc3.request(`/api/devices/${deviceId}`);
      const afterVars: any[] = after?.properties?.quickAppVariables ?? [];
      if (afterVars.find(v => v.name === name)) {
        throw new Error(
          `Post-delete verification failed: variable '${name}' still present on device ${deviceId}.`
        );
      }

      return {
        deviceId,
        name,
        deleted: { type: existing.type, value: existing.value }
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

    async import_quickapp(hc3, args: {
      base64?: string;
      filePath?: string;
      fileName?: string;
      roomId?: number;
    }): Promise<any> {
      const hasB64 = typeof args?.base64 === 'string' && args.base64.length > 0;
      const hasPath = typeof args?.filePath === 'string' && args.filePath.length > 0;
      if (hasB64 === hasPath) {
        throw new Error(
          'import_quickapp requires exactly one of base64 or filePath. ' +
          'Prefer base64 when driving a remote server — filePath is resolved on the host running this MCP server, not on your machine.'
        );
      }
      if (!hc3.config.host || !hc3.config.username || !hc3.config.password) {
        throw new Error('Fibaro HC3 not configured.');
      }

      let bytes: Buffer;
      if (hasB64) {
        bytes = Buffer.from(args.base64 as string, 'base64');
      } else {
        try {
          bytes = await readFile(args.filePath as string);
        } catch (e: any) {
          throw new Error(
            `import_quickapp: could not read '${args.filePath}' on the MCP server host (${e.code ?? e.message}). ` +
            'This path is resolved server-side; if the file lives on your own machine, pass it as base64 instead.'
          );
        }
      }
      if (bytes.length === 0) throw new Error('import_quickapp: the .fqa payload is empty.');

      // A .fqa is JSON. Validating here turns a truncated or wrongly-encoded
      // payload into a precise error instead of HC3's bare "Cannot import
      // quick app file", which says nothing about what was wrong.
      let fqa: any;
      try {
        fqa = JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new Error(
          `import_quickapp: payload is not valid JSON (${bytes.length} bytes). A .fqa is a JSON document — check the base64 round-trip, and that the file is not a .fqax or an archive.`
        );
      }
      if (!fqa || typeof fqa !== 'object' || (!fqa.name && !fqa.type)) {
        throw new Error(
          'import_quickapp: payload parsed as JSON but has neither a "name" nor a "type" key, so it does not look like a .fqa export.'
        );
      }

      const fileName = args.fileName
        ?? (hasPath ? (args.filePath as string).split('/').pop() || 'import.fqa' : 'import.fqa');

      const boundary = '----mcphc3' + Date.now().toString(16);
      const CRLF = '\r\n';
      const partHead = (name: string, filename?: string, type?: string) =>
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"` +
        (filename ? `; filename="${filename}"` : '') + CRLF +
        (type ? `Content-Type: ${type}${CRLF}` : '') + CRLF;

      const tail = (typeof args.roomId === 'number'
        ? partHead('roomId') + String(args.roomId) + CRLF
        : '') + `--${boundary}--${CRLF}`;
      const body = Buffer.concat([
        Buffer.from(partHead('file', fileName, 'application/json')),
        bytes,
        Buffer.from(CRLF + tail)
      ]);

      const auth = Buffer.from(`${hc3.config.username}:${hc3.config.password}`).toString('base64');
      const response = await fetch(`http://${hc3.config.host}:${hc3.config.port}/api/quickApp/import`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let reason = '';
        let detail = '';
        try {
          const parsed = JSON.parse(errText);
          reason = typeof parsed?.reason === 'string' ? parsed.reason : '';
          detail = typeof parsed?.message === 'string' ? parsed.message : '';
        } catch { /* non-JSON body — fall through to the raw text */ }
        const summary = [reason, detail].filter(Boolean).join(': ');
        const hint = response.status === 403
          ? ' HC3 returns 403 when the .fqa was encrypted for a different gateway; those can only be imported on their origin controller.'
          : '';
        throw new Error(
          `import_quickapp: HTTP ${response.status}${summary ? ` ${summary}` : ''} — raw response: ${errText || '(empty body)'}.${hint}`
        );
      }

      const created: any = await response.json().catch(() => null);
      const newId = created?.id;
      if (typeof newId !== 'number') {
        throw new Error(
          `import_quickapp: HC3 accepted the upload but returned no device id. Raw response: ${JSON.stringify(created)}`
        );
      }

      // Post-write verify, matching the pattern used across this module.
      const device: any = await hc3.request(`/api/devices/${newId}`);
      if (!device || device.id !== newId) {
        throw new Error(
          `import_quickapp: HC3 reported device ${newId} but refetching it did not return that device.`
        );
      }
      return {
        deviceId: newId,
        name: device.name,
        type: device.type,
        roomID: device.roomID,
        enabled: device.enabled,
        visible: device.visible,
        source: hasB64 ? 'base64' : `filePath (server-side): ${args.filePath}`,
        hint: `Populate or inspect files via list_quickapp_files({deviceId: ${newId}}) / get_quickapp_file. Remove with delete_device({deviceId: ${newId}}) if this was a test import.`
      };
    },
  },
};
