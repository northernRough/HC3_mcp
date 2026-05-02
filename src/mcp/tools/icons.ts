// Icon tools (list/get/upload/delete). Two of the four bypass
// HC3Client.request() because they need raw bytes (get_icon) or
// multipart form-data (upload_icon); they read host/port/credentials
// from hc3.config and hand-roll the fetch.
//
// Behaviours preserved verbatim:
// - get_icon detects HC3's silent SVG-fallback for missing PNGs
//   (1.9 KB "unknown icon" substituted instead of 404).
// - upload_icon pre-validates PNG bytes (signature, 128×128, palette
//   color type 3) at the tool boundary; HC3 silent-500s on any
//   other shape.
// - delete_icon uses query params (NOT JSON body) and refuses to
//   delete built-in icons (HC3 returns 403 on non-user icons; the
//   post-delete refetch catches them too).

import { ToolModule } from './registry';

export const icons: ToolModule = {
  schemas: [
      {
        name: 'list_icons',
        description: 'List all icons HC3 knows about, grouped by `device` / `room` / `scene`. Each entry has the icon name, fileExtension (typically "png" or "svg"), and an internal id. Built-in icons live under /assets/icon/fibaro/{rooms,scena,...}/; user-uploaded icons live under /assets/userIcons/...',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_icon',
        description: 'Fetch an icon\'s binary content from HC3, base64-encoded. Built-in icons resolve to /assets/icon/fibaro/{category}/{name}.{ext}; user-uploaded icons resolve to /assets/userIcons/{category}/{name}.{ext} when userIcon=true. Returns {name, mime, base64, sizeBytes}. The MCP itself does not manipulate images — decode, edit (e.g. with ImageMagick or sips for PNGs, text edits for SVGs), then upload via upload_icon under a new name. Built-in icons cannot be replaced in place; uploads always create user icons.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Icon category. Maps to URL segment: "room"→rooms, "scene"→scena, "device"→{deviceType}/{iconSetName}.' },
            name: { type: 'string', description: 'Icon name (e.g. "room_bedroom"). For device icons see list_icons → device[].iconSetName.' },
            extension: { type: 'string', description: 'File extension. Defaults to "png" for room/scene, must be supplied accurately for device icons (often "svg").' },
            userIcon: { type: 'boolean', description: 'If true, fetch from /assets/userIcons instead of /assets/icon/fibaro. Default false.' }
          },
          required: ['category', 'name']
        }
      },
      {
        name: 'upload_icon',
        description: 'Upload a new user icon via POST /api/icons (multipart/form-data with type, icon, fileExtension). HC3 ignores any caller-supplied filename and auto-assigns "User<N>". Returns the assigned `newName` and `newId` so you can attach via modify_room/modify_scene/etc. (e.g. modify_room({roomId, fields:{icon: "User1010"}})). HC3 5.x has two undocumented PNG constraints that silent-500 if violated: dimensions must be exactly **128×128**, AND the colorspace must be **palette (8-bit colormap, PNG color type 3)** — not RGB or RGBA. Use `magick input.png -resize 128x128 -dither None -colors 256 -define png:color-type=3 output.png` (ImageMagick) or `pngquant --quality=80 input.png` to produce a compatible palette PNG. Returns `{newName, newId, category, extension, hint}`.',
        inputSchema: {
          type: 'object',
          properties: {
            base64: { type: 'string', description: 'Base64-encoded image bytes (no data URL prefix). For PNG: must be 128×128 in palette mode (8-bit colormap, color type 3). For SVG: as-is.' },
            mime: { type: 'string', description: '"image/png" or "image/svg+xml".' },
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Category — records under that bucket in list_icons.' }
          },
          required: ['base64', 'mime', 'category']
        }
      },
      {
        name: 'delete_icon',
        description: 'Delete a user-uploaded icon via DELETE /api/icons. Uses query params (type, id, name, fileExtension) — NOT a JSON body. type must be the icon\'s category ("room", "scene", or "device") — passing "custom" returns 400 WRONG_TYPE. The tool resolves `id` automatically from list_icons unless you pass it explicitly. Built-in icons cannot be deleted; only user-uploaded User<N> icons. Post-delete verifies by re-listing.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Icon name (typically User<N>).' },
            fileExtension: { type: 'string', description: 'File extension matching the stored icon ("png" or "svg").' },
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Icon category. Used both for the existence pre-check and as the type query param.' },
            id: { type: 'number', description: 'Optional. If omitted, looked up via list_icons.' }
          },
          required: ['name', 'fileExtension', 'category']
        }
      },
  ],

  handlers: {
    async list_icons(hc3): Promise<any> {
      return await hc3.request('/api/icons');
    },

    async get_icon(hc3, args: {
      category: 'room' | 'scene' | 'device';
      name: string;
      extension?: string;
      userIcon?: boolean;
    }): Promise<any> {
      if (!args?.category) throw new Error('get_icon requires category.');
      if (!args?.name) throw new Error('get_icon requires name.');
      const ext = args.extension ?? 'png';
      const segment = args.category === 'room' ? 'rooms'
        : args.category === 'scene' ? 'scena'
        : args.category;
      const base = args.userIcon ? '/assets/userIcons' : '/assets/icon/fibaro';
      const path = `${base}/${segment}/${encodeURIComponent(args.name)}.${ext}`;
      const url = `http://${hc3.config.host}:${hc3.config.port}${path}`;
      const auth = Buffer.from(`${hc3.config.username}:${hc3.config.password}`).toString('base64');
      const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${auth}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error(`get_icon: HTTP ${response.status} fetching ${path}`);
      }
      const mime = response.headers.get('content-type') ?? 'application/octet-stream';
      const buf = Buffer.from(await response.arrayBuffer());
      // Detect HC3's silent-fallback for missing icons: when a .png path is
      // requested but the server returns image/svg+xml, HC3 has substituted its
      // 1888-byte "unknown icon" SVG fallback rather than 404'ing.
      if (ext === 'png' && mime.startsWith('image/svg')) {
        throw new Error(
          `get_icon: ${path} not found — HC3 silently returned its SVG "unknown icon" fallback (1.9 KB) instead of 404. Check name/extension via list_icons.`
        );
      }
      return {
        name: args.name,
        extension: ext,
        mime,
        sizeBytes: buf.length,
        base64: buf.toString('base64')
      };
    },

    async upload_icon(hc3, args: {
      base64: string;
      mime: string;
      category: 'room' | 'scene' | 'device';
    }): Promise<any> {
      if (!args?.base64) throw new Error('upload_icon requires base64.');
      if (!args?.mime) throw new Error('upload_icon requires mime.');
      if (!args?.category) throw new Error('upload_icon requires category.');
      if (!hc3.config.host || !hc3.config.username || !hc3.config.password) {
        throw new Error('Fibaro HC3 not configured.');
      }
      const ext = args.mime === 'image/svg+xml' ? 'svg'
        : args.mime === 'image/png' ? 'png'
        : args.mime === 'image/jpeg' ? 'jpg'
        : 'png';
      const bytes = Buffer.from(args.base64, 'base64');

      // Validate PNG dimensions + palette mode at the tool boundary so callers
      // get a clear error rather than HC3's misleading silent-500 on RGB or
      // wrong-size PNGs.
      if (ext === 'png') {
        if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
          throw new Error('upload_icon: provided bytes are not a valid PNG.');
        }
        const width = bytes.readUInt32BE(16);
        const height = bytes.readUInt32BE(20);
        const colorType = bytes.readUInt8(25);
        if (width !== 128 || height !== 128) {
          throw new Error(
            `upload_icon: PNG must be 128x128. Got ${width}x${height}. HC3 silently 500s on other dimensions. Resize with e.g. \`magick input.png -resize 128x128 output.png\`.`
          );
        }
        if (colorType !== 3) {
          throw new Error(
            `upload_icon: PNG must be palette mode (color type 3 / 8-bit colormap). Got color type ${colorType}. HC3 silently 500s on RGB/RGBA. Convert with e.g. \`magick in.png -dither None -colors 256 -define png:color-type=3 out.png\` or \`pngquant in.png\`.`
          );
        }
      }

      const before: any = await hc3.request('/api/icons');
      const bucketBefore: any[] = (before?.[args.category] as any[]) || [];
      const userIdsBefore = new Set(bucketBefore.map(i => i.id));

      // Manual multipart so we control the bytes exactly. Node 18's FormData +
      // Blob is fine in principle, but explicit construction matches what curl
      // -F sends and avoids any boundary/header surprises.
      const boundary = '----mcphc3' + Date.now().toString(16);
      const CRLF = '\r\n';
      const partHead = (name: string, filename?: string, type?: string) =>
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"` +
        (filename ? `; filename="${filename}"` : '') + CRLF +
        (type ? `Content-Type: ${type}${CRLF}` : '') + CRLF;
      const body = Buffer.concat([
        Buffer.from(partHead('type') + args.category + CRLF + partHead('icon', `mcp.${ext}`, args.mime)),
        bytes,
        Buffer.from(CRLF + partHead('fileExtension') + ext + CRLF + `--${boundary}--${CRLF}`)
      ]);

      const auth = Buffer.from(`${hc3.config.username}:${hc3.config.password}`).toString('base64');
      const response = await fetch(`http://${hc3.config.host}:${hc3.config.port}/api/icons`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (response.status === 500 && ext === 'png') {
          throw new Error(
            `upload_icon: HTTP 500 from HC3. The pre-checks (128x128, palette mode) passed at the tool boundary, so HC3 may be in a bad state — try again, or restart HC3 if persistent. Raw response: ${errText}`
          );
        }
        throw new Error(`upload_icon: HTTP ${response.status} - ${errText}`);
      }

      // HC3 returns {id, iconSetName, fileExtension} on success. Capture from the response;
      // also re-list as a sanity check.
      try { JSON.parse(await response.text()); } catch { /* unused — verify path is via re-listing */ }
      const after: any = await hc3.request('/api/icons');
      const bucketAfter: any[] = (after?.[args.category] as any[]) || [];
      const newOnes = bucketAfter.filter(i => !userIdsBefore.has(i.id));
      if (newOnes.length === 0) {
        throw new Error(
          `upload_icon: post-upload verify failed — no new icon appeared in ${args.category} bucket. HC3 silently dropped the upload despite returning 2xx.`
        );
      }
      const fresh = newOnes[0];
      const newName = fresh.iconName || fresh.iconSetName;
      return {
        newName,
        newId: fresh.id,
        category: args.category,
        extension: ext,
        hint: `Attach with modify_room/modify_scene/etc. (e.g. modify_room({roomId, fields:{icon: "${newName}"}})). Re-fetch later via get_icon({category: "${args.category}", name: "${newName}", extension: "${ext}", userIcon: true}).`
      };
    },

    async delete_icon(hc3, args: {
      name: string;
      fileExtension: string;
      category: 'room' | 'scene' | 'device';
      id?: number;
    }): Promise<any> {
      if (!args?.name) throw new Error('delete_icon requires name.');
      if (!args?.fileExtension) throw new Error('delete_icon requires fileExtension.');
      if (!args?.category) throw new Error('delete_icon requires category.');

      const before: any = await hc3.request('/api/icons');
      const bucket: any[] = (before?.[args.category] as any[]) || [];
      const found = bucket.find(i =>
        i.iconName === args.name || i.iconSetName === args.name
      );
      if (!found) {
        throw new Error(
          `delete_icon: '${args.name}' not found in ${args.category} bucket. ` +
          `Use list_icons to inspect.`
        );
      }
      const id = args.id ?? found.id;
      if (typeof id !== 'number') {
        throw new Error(`delete_icon: could not resolve id for '${args.name}'. Pass id explicitly.`);
      }

      // HC3's DELETE /api/icons uses query params (NOT a JSON body) and requires
      // type ∈ {device, room, scene} (NOT "custom" as some docs say) plus id,
      // name, and fileExtension. All four are required.
      const params = new URLSearchParams({
        type: args.category,
        id: String(id),
        name: args.name,
        fileExtension: args.fileExtension,
      });
      await hc3.request(`/api/icons?${params.toString()}`, 'DELETE');

      const after: any = await hc3.request('/api/icons');
      const stillThere = (after?.[args.category] as any[] ?? []).find(i =>
        i.iconName === args.name || i.iconSetName === args.name
      );
      if (stillThere) {
        throw new Error(
          `delete_icon: post-delete verify failed — '${args.name}' still in the ${args.category} bucket. ` +
          `Built-in icons cannot be deleted via the API; only user-uploaded icons (User<N>) can.`
        );
      }
      return { deleted: args.name, id, category: args.category };
    },
  },
};
