// stdio transport for MCP. Reads newline-delimited JSON-RPC frames from
// stdin, hands each one to the dispatcher, writes responses back to stdout
// (notifications return null and emit nothing).
//
// Extracted from hc3-mcp-server.ts. Behaviour is byte-identical to the
// previous in-class setupStdioHandler + sendResponse.

import { MCPResponse } from '../types';

type Dispatch = (line: string) => Promise<MCPResponse | null>;

export function setupStdio(dispatch: Dispatch): void {
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
        dispatch(line).then(resp => {
          if (resp) sendResponse(resp);
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

function sendResponse(response: MCPResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}
