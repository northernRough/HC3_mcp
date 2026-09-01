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

/**
 * A non-2xx answer from HC3, carrying the status as DATA.
 *
 * The message names the request, because it did not before. 51 of the 83
 * failures in this project's own friction log were the bare string
 * "HTTP 404: Not Found" — no method, no path, no id — from two tools over
 * seventeen days. HC3 sends an empty body on 404, so there was nothing else on
 * the line, and `recordFailure` stores only the tool and the message. The
 * largest cluster in the telemetry was undiagnosable by construction.
 *
 * The status is a field rather than only a substring because putting the path
 * in the message breaks message-scraping. Callers recognised "gone" with
 * `/404|not.?found/i` against the message, and an id like 4046 or 1404
 * CONTAINS "404" — so a 500 on /api/devices/4046 would have read as a
 * successful deletion. Use `isNotFound`, which reads the status.
 */
export class HC3HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly method: string;
  readonly endpoint: string;
  /** HC3's response body, trimmed. Empty on most 4xx — notably every 404. */
  readonly body: string;

  constructor(status: number, statusText: string, method: string, endpoint: string, body: string) {
    super(`HTTP ${status}: ${statusText} (${method} ${endpoint})${body ? ` - ${body}` : ''}`);
    this.name = 'HC3HttpError';
    this.status = status;
    this.statusText = statusText;
    this.method = method;
    this.endpoint = endpoint;
    this.body = body;
  }
}

/**
 * Is this error HC3 saying the thing is not there?
 *
 * Status first, so an id containing "404" cannot be mistaken for one. The
 * message fallback is for errors this server raised itself — tool guards that
 * say "not found" in prose and never went near the gateway.
 */
export function isNotFound(error: unknown): boolean {
  const status = (error as any)?.status;
  if (typeof status === 'number') return status === 404;
  return /404|not.?found/i.test(String((error as any)?.message ?? error ?? ''));
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
      throw new HC3HttpError(response.status, response.statusText, method, endpoint, text.trim());
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
