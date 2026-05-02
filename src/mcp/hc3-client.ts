// Thin REST client for Fibaro HC3. Owns connection config (host, port,
// credentials) and the request transport including the JSON-RPC envelope
// error check on action endpoints.
//
// Extracted from hc3-mcp-server.ts. Behaviour is identical to the previous
// in-class makeApiRequest: same URL shape, same Basic auth, same 15s
// timeout, same envelope-error throw, same return value semantics.

export interface HC3Config {
  host: string;
  port: number;
  username: string;
  password: string;
}

export class HC3Client {
  readonly config: HC3Config;

  constructor(config: HC3Config) {
    this.config = config;
  }

  static fromEnv(): HC3Client {
    return new HC3Client({
      host: process.env.FIBARO_HOST as string,
      username: process.env.FIBARO_USERNAME as string,
      password: process.env.FIBARO_PASSWORD as string,
      port: process.env.FIBARO_PORT ? parseInt(process.env.FIBARO_PORT) : 80,
    });
  }

  async request(endpoint: string, method = 'GET', data?: any): Promise<any> {
    if (!this.config.host || !this.config.username || !this.config.password) {
      throw new Error('Fibaro HC3 not configured. Please check environment variables.');
    }

    const url = `http://${this.config.host}:${this.config.port}${endpoint}`;
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');

    const headers: Record<string, string> = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    };

    const requestOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(15000),
    };

    if (data && method !== 'GET') {
      requestOptions.body = JSON.stringify(data);
    }

    const response = await fetch(url, requestOptions);
    const text = await response.text();

    if (!response.ok) {
      const detail = text.trim();
      const suffix = detail ? ` - ${detail}` : '';
      throw new Error(`HTTP ${response.status}: ${response.statusText}${suffix}`);
    }

    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text);

    // HC3 action endpoints return HTTP 202 with a JSON-RPC envelope
    // ({jsonrpc, id, error, result, ...}). A non-null `error` means the
    // request was accepted but failed — "not implemented" etc. Without
    // this check, those failures masquerade as success.
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'jsonrpc' in parsed &&
      parsed.error !== null &&
      parsed.error !== undefined &&
      typeof parsed.error === 'object'
    ) {
      const code = (parsed.error as any).code;
      const msg = (parsed.error as any).message ?? JSON.stringify(parsed.error);
      throw new Error(`HC3 action failed for ${method} ${endpoint} (code ${code}): ${msg}`);
    }

    return parsed;
  }
}
