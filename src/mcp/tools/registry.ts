// Tool-module registry. Each tool domain (devices, scenes, alarm, …)
// exports a ToolModule whose `schemas` feed tools/list and whose `handlers`
// feed tools/call. The server merges all modules into one registry at boot;
// the dispatcher in handleCallTool consults the registry by tool name.
//
// Migration is incremental: tools not yet ported still live as inline
// schemas + switch arms in hc3-mcp-server.ts, and the registry-miss path
// falls through to that legacy switch.

import { MCPTool } from '../types';
import { HC3Client } from '../hc3-client';

export type ToolHandler = (hc3: HC3Client, args: any) => Promise<any>;

export interface ToolModule {
  schemas: MCPTool[];
  handlers: Record<string, ToolHandler>;
}

export function mergeHandlers(modules: ToolModule[]): Record<string, ToolHandler> {
  const merged: Record<string, ToolHandler> = {};
  for (const m of modules) {
    for (const [name, fn] of Object.entries(m.handlers)) {
      if (name in merged) {
        throw new Error(`Tool registry collision on '${name}'.`);
      }
      merged[name] = fn;
    }
  }
  return merged;
}
