// MCP JSON-RPC envelope types and the tool-schema shape exposed via
// tools/list. Extracted from hc3-mcp-server.ts so tool modules can be
// authored without importing the server.

export interface MCPRequest {
  jsonrpc: string;
  id?: string | number;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: string;
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
    /**
     * JSON Schema conditionals. A requirement that depends on another
     * argument (deviceTemplate only when category is "device") can then be
     * stated in schema rather than in prose, which is the only form a client
     * can act on before the call is made.
     */
    if?: Record<string, any>;
    then?: Record<string, any>;
    else?: Record<string, any>;
    anyOf?: Record<string, any>[];
    allOf?: Record<string, any>[];
    oneOf?: Record<string, any>[];
  };
}
