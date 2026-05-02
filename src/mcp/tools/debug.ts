// HC3 debug-message tools.

import { ToolModule } from './registry';

export const debug: ToolModule = {
  schemas: [
    {
      name: 'clear_debug_messages',
      description: 'Clear all debug messages on HC3 via DELETE /api/debugMessages. Useful for test loops — clear before running a scene or QA action, then read get_debug_messages to see only the fresh logs. Read-then-delete: counts messages before deletion so the response reports how many were cleared.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_debug_messages',
      description: 'Read HC3 debug messages with client-side filtering. HC3 returns a fixed page of 30 messages newest-first and ignores query-param filters, so this tool paginates via the "last" cursor and applies filters locally. Returns a summary object plus the matching messages.',
      inputSchema: {
        type: 'object',
        properties: {
          tagContains: {
            type: 'string',
            description: 'Case-insensitive substring match against the message tag (e.g. "DAIKIN" matches "DAIKIN-4710").',
          },
          since: {
            type: 'number',
            description: 'Epoch seconds. Only messages with timestamp >= this value are returned. Also stops pagination once the oldest fetched page is older than this.',
          },
          type: {
            type: 'string',
            description: 'Filter by message type.',
            enum: ['error', 'warning', 'info', 'debug', 'trace'],
          },
          limit: {
            type: 'number',
            description: 'Maximum number of matching messages to return (default: 100). Applied AFTER filtering.',
          },
          maxPages: {
            type: 'number',
            description: 'Safety cap on HC3 pages fetched (default: 10, ~300 raw messages). Raise if a filter needs deeper history.',
          },
        },
      },
    },
  ],

  handlers: {
    async clear_debug_messages(hc3): Promise<any> {
      let cleared: number | null = null;
      try {
        const before: any = await hc3.request('/api/debugMessages');
        cleared = Array.isArray(before) ? before.length
          : (Array.isArray(before?.messages) ? before.messages.length : null);
      } catch {
        // non-fatal; DELETE still proceeds, just no count
      }
      await hc3.request('/api/debugMessages', 'DELETE');
      return { cleared };
    },

    async get_debug_messages(hc3, args: {
      tagContains?: string;
      since?: number;
      type?: string;
      limit?: number;
      maxPages?: number;
    }): Promise<any> {
      const limit = args.limit ?? 100;
      const maxPages = args.maxPages ?? 10;
      const since = args.since;
      const typeFilter = args.type;
      const tagNeedle = args.tagContains?.toLowerCase();

      const matches = (m: any) => {
        if (typeFilter && m.type !== typeFilter) return false;
        if (since !== undefined && m.timestamp < since) return false;
        if (tagNeedle && !(typeof m.tag === 'string' && m.tag.toLowerCase().includes(tagNeedle))) return false;
        return true;
      };

      const collected: any[] = [];
      let fetched = 0;
      let pages = 0;
      let cursor: number | undefined = undefined;
      let truncatedBy: 'limit' | 'maxPages' | null = null;
      let crossedSince = false;

      while (pages < maxPages) {
        const url = cursor !== undefined ? `/api/debugMessages?last=${cursor}` : '/api/debugMessages';
        const page = await hc3.request(url);
        pages++;
        const messages: any[] = page?.messages ?? [];
        fetched += messages.length;

        for (const m of messages) {
          if (matches(m)) {
            collected.push(m);
            if (collected.length >= limit) {
              truncatedBy = 'limit';
              break;
            }
          }
        }
        if (truncatedBy === 'limit') break;

        const oldest = messages[messages.length - 1]?.timestamp;
        if (since !== undefined && oldest !== undefined && oldest < since) {
          crossedSince = true;
          break;
        }

        const nextLast = page?.nextLast;
        if (!nextLast || nextLast === 0) break;
        cursor = nextLast;
      }

      if (truncatedBy === null && pages >= maxPages && !crossedSince) {
        truncatedBy = 'maxPages';
      }

      const timestamps = collected.map(m => m.timestamp).filter((t: any) => typeof t === 'number');
      return {
        summary: {
          fetched,
          matched: collected.length,
          returned: collected.length,
          pages,
          oldestTimestamp: timestamps.length ? Math.min(...timestamps) : null,
          newestTimestamp: timestamps.length ? Math.max(...timestamps) : null,
          truncatedBy,
        },
        messages: collected,
      };
    },
  },
};
