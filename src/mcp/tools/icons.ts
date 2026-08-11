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
// - upload_icon sends a `deviceTemplate` part when category is
//   "device". HC3 400s with MISSING_PARAMETER without it — device
//   icons are filed per device type, unlike room/scene icons.
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
        description: 'Fetch an icon\'s binary content from HC3, base64-encoded. Returns {name, extension, mime, sizeBytes, path, base64}.\n\nPath layouts (verified against firmware 5.210.12): room → `rooms/{name}.{ext}`; scene → `scena/{name}.{ext}` built-in, `scenes/{name}.{ext}` user; **device → `{iconSetName}/{iconSetName}[state].{ext}`** — each device icon set is its own directory holding one file per state, and `deviceType` is NOT part of the path despite what list_icons might suggest. Built-in icons sit under /assets/icon/fibaro, user icons under /assets/userIcons.\n\nHC3 answers **200 with a placeholder** for missing icons rather than 404 (a 1888-byte "unknown icon" SVG, or its web UI index.html), so this tool inspects the content and raises rather than handing back a plausible-looking wrong image. Known gap: user-uploaded *device* icons are not served under any known /assets path on 5.210.12 — they work as `deviceIcon` ids but cannot be fetched back as files.\n\nThe MCP itself does not manipulate images — decode, edit (e.g. ImageMagick or sips for PNGs, text edits for SVGs), then upload via upload_icon under a new name. Built-in icons cannot be replaced in place; uploads always create user icons.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Icon category — selects the path layout (see description).' },
            name: { type: 'string', description: 'Icon name. For room/scene use list_icons → {room,scene}[].iconName; for device use device[].iconSetName (NOT deviceType).' },
            extension: { type: 'string', description: 'File extension, "png" or "svg". Defaults to "png". Take it from the matching list_icons entry\'s fileExtension — guessing produces a placeholder, which this tool rejects.' },
            userIcon: { type: 'boolean', description: 'If true, fetch from /assets/userIcons instead of /assets/icon/fibaro. Default false.' },
            state: { type: 'number', description: 'Optional state index for device icon sets that hold one file per state (e.g. zraszacz/zraszacz0.png). Omit to try the unsuffixed file then state 0.' }
          },
          required: ['category', 'name']
        }
      },
      {
        name: 'upload_icon',
        description: 'Upload a new user icon via POST /api/icons (multipart/form-data with type, icon, fileExtension, and — for device icons — deviceTemplate). HC3 ignores any caller-supplied filename and auto-assigns "User<N>". Returns the assigned `newName` and `newId` so you can attach via modify_room/modify_scene/modify_device (e.g. modify_room({roomId, fields:{icon: "User1010"}})).\n\n**category "device" additionally requires `deviceTemplate`** — the Fibaro device type the icon is filed under, e.g. "com.fibaro.binarySwitch". Device icons are stored per device type; room and scene icons are not, and must not pass it. Omitting it on a device upload returns HTTP 400 MISSING_PARAMETER. Discover valid values from list_icons → device[].deviceType, or get_quickapp_available_types. To icon a QuickApp, pass that QA\'s own type.\n\nPNG payloads have two undocumented HC3 5.x constraints that silent-500 if violated: dimensions must be exactly **128×128**, AND the colorspace must be **palette (8-bit colormap, PNG color type 3)** — not RGB or RGBA. Use `magick input.png -resize 128x128 -dither None -colors 256 -define png:color-type=3 output.png` (ImageMagick) or `pngquant --quality=80 input.png`. SVG is genuinely supported and is uploaded as-is with no size or colour constraints. Returns `{newName, newId, category, extension, hint}`.',
        inputSchema: {
          type: 'object',
          properties: {
            base64: { type: 'string', description: 'Base64-encoded image bytes (no data URL prefix). For PNG: must be 128×128 in palette mode (8-bit colormap, color type 3). For SVG: as-is.' },
            mime: { type: 'string', description: '"image/png" or "image/svg+xml".' },
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Category — records under that bucket in list_icons.' },
            deviceTemplate: { type: 'string', description: 'Required when category is "device", rejected otherwise. The Fibaro device type the icon is filed under, e.g. "com.fibaro.binarySwitch". See list_icons → device[].deviceType for values already in use on this HC3.' }
          },
          required: ['base64', 'mime', 'category']
        }
      },
      {
        name: 'delete_icon',
        description: 'Delete a user-uploaded icon via DELETE /api/icons. Uses query params (type, id, name, fileExtension) — NOT a JSON body. type must be the icon\'s category ("room", "scene", or "device") — passing "custom" returns 400 WRONG_TYPE. The tool resolves `id` automatically from list_icons unless you pass it explicitly. Built-in icons cannot be deleted; only user-uploaded User<N> icons. Post-delete verifies by re-listing.\n\n**In-use guard:** before deleting, the tool scans for objects still referencing the icon (devices via properties.deviceIcon, rooms/scenes via their icon field) and refuses if any are found, since the delete is immediate and the image bytes are unrecoverable. Pass `force: true` to override. A scan that cannot complete also refuses rather than assuming the icon is unused.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Icon name (typically User<N>).' },
            fileExtension: { type: 'string', description: 'File extension matching the stored icon ("png" or "svg").' },
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Icon category. Used both for the existence pre-check and as the type query param.' },
            id: { type: 'number', description: 'Optional. If omitted, looked up via list_icons.' },
            force: { type: 'boolean', description: 'Delete even if the icon is still referenced, or if the in-use scan failed. Default false.' }
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
      state?: number;
    }): Promise<any> {
      if (!args?.category) throw new Error('get_icon requires category.');
      if (!args?.name) throw new Error('get_icon requires name.');
      const ext = args.extension ?? 'png';
      const name = encodeURIComponent(args.name);
      const base = args.userIcon ? '/assets/userIcons' : '/assets/icon/fibaro';

      // Path layouts, all established by probing the live gateway (5.210.12).
      // Device icons are NOT under a "device" or {deviceType} segment: each
      // icon set is its own directory holding one file per state, e.g.
      // /assets/icon/fibaro/zraszacz/zraszacz0.png. Some sets also carry an
      // unsuffixed file, so both are tried. Room/scene user icons live under
      // different segment names than their built-in counterparts ("scenes"
      // vs "scena"), which is why a user scene icon never resolved before.
      const candidates: string[] = [];
      if (args.category === 'device') {
        if (typeof args.state === 'number') {
          candidates.push(`${base}/${name}/${name}${args.state}.${ext}`);
        } else {
          candidates.push(`${base}/${name}/${name}.${ext}`);
          candidates.push(`${base}/${name}/${name}0.${ext}`);
        }
      } else if (args.category === 'room') {
        candidates.push(`${base}/rooms/${name}.${ext}`);
      } else {
        // Built-in scene icons sit under "scena"; user scene icons under
        // "scenes". Try the likely one first, then the other.
        candidates.push(`${base}/${args.userIcon ? 'scenes' : 'scena'}/${name}.${ext}`);
        candidates.push(`${base}/${args.userIcon ? 'scena' : 'scenes'}/${name}.${ext}`);
      }

      const auth = Buffer.from(`${hc3.config.username}:${hc3.config.password}`).toString('base64');
      const tried: string[] = [];
      for (const path of candidates) {
        const response = await fetch(`http://${hc3.config.host}:${hc3.config.port}${path}`, {
          headers: { 'Authorization': `Basic ${auth}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) { tried.push(`${path} → HTTP ${response.status}`); continue; }
        const mime = response.headers.get('content-type') ?? 'application/octet-stream';
        const buf = Buffer.from(await response.arrayBuffer());

        // HC3 answers 200 for missing assets, in two shapes, so status alone
        // proves nothing. Both must be rejected or the caller gets a
        // plausible-looking icon that is not the one asked for.
        //   - under /assets/icon/fibaro: a 1888-byte "unknown icon" SVG
        //   - anywhere else: the ~13 KB SPA index.html
        if (mime.includes('html')) {
          tried.push(`${path} → HC3 served its web UI index (path not routed)`);
          continue;
        }
        if (mime.startsWith('image/svg') && buf.length === 1888) {
          tried.push(`${path} → HC3's "unknown icon" SVG placeholder`);
          continue;
        }
        // A png request answered with svg is the same placeholder wearing a
        // different size; keep the original guard as a backstop.
        if (ext === 'png' && mime.startsWith('image/svg')) {
          tried.push(`${path} → SVG returned for a .png request (placeholder)`);
          continue;
        }
        return {
          name: args.name,
          extension: ext,
          mime,
          sizeBytes: buf.length,
          path,
          base64: buf.toString('base64')
        };
      }

      const userDeviceNote = args.category === 'device' && args.userIcon
        ? ' NOTE: user-uploaded *device* icons are not served under any known /assets path on 5.210.12 — they are addressable by numeric id via a device\'s deviceIcon property, but not fetchable as a file. Built-in device icons work.'
        : '';
      throw new Error(
        `get_icon: could not fetch '${args.name}' (${args.category}, .${ext}). HC3 returns 200 with a placeholder for missing icons rather than 404, so each candidate was checked for content and rejected:\n  ${tried.join('\n  ')}\n` +
        `Confirm the name and fileExtension via list_icons — for device icons use device[].iconSetName (NOT deviceType, which is not part of the path).${userDeviceNote}`
      );
    },

    async upload_icon(hc3, args: {
      base64: string;
      mime: string;
      category: 'room' | 'scene' | 'device';
      deviceTemplate?: string;
    }): Promise<any> {
      if (!args?.base64) throw new Error('upload_icon requires base64.');
      if (!args?.mime) throw new Error('upload_icon requires mime.');
      if (!args?.category) throw new Error('upload_icon requires category.');
      if (!hc3.config.host || !hc3.config.username || !hc3.config.password) {
        throw new Error('Fibaro HC3 not configured.');
      }

      // Device icons are filed per device type, so HC3 requires a
      // deviceTemplate part; room/scene icons are not and reject it.
      // Caught here rather than letting HC3 answer with a bare
      // MISSING_PARAMETER, which gives the caller nothing to act on.
      if (args.category === 'device' && !args.deviceTemplate) {
        throw new Error(
          'upload_icon: category "device" requires deviceTemplate — the Fibaro device type the icon is filed under, e.g. "com.fibaro.binarySwitch". ' +
          'Without it HC3 returns 400 MISSING_PARAMETER. Discover valid values from list_icons (device[].deviceType) or get_quickapp_available_types; ' +
          'to icon a QuickApp, pass that QA\'s own type. Room and scene icons do not take this parameter.'
        );
      }
      if (args.category !== 'device' && args.deviceTemplate) {
        throw new Error(
          `upload_icon: deviceTemplate only applies to category "device", not "${args.category}". Drop it, or set category to "device".`
        );
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
      // deviceTemplate is appended last so the room/scene body stays
      // byte-identical to the framing that is known to work.
      const tail = partHead('fileExtension') + ext + CRLF
        + (args.deviceTemplate ? partHead('deviceTemplate') + args.deviceTemplate + CRLF : '')
        + `--${boundary}--${CRLF}`;
      const body = Buffer.concat([
        Buffer.from(partHead('type') + args.category + CRLF + partHead('icon', `mcp.${ext}`, args.mime)),
        bytes,
        Buffer.from(CRLF + tail)
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
        // HC3 answers errors as {type, reason, message}. Pull the structured
        // fields out when present so the caller sees *which* parameter HC3
        // objected to, not just a status code and an opaque blob.
        let reason = '';
        let detail = '';
        try {
          const parsed = JSON.parse(errText);
          reason = typeof parsed?.reason === 'string' ? parsed.reason : '';
          detail = typeof parsed?.message === 'string' ? parsed.message : '';
        } catch { /* non-JSON body — fall through to the raw text */ }

        const summary = [reason, detail].filter(Boolean).join(': ');
        if (response.status === 500 && ext === 'png') {
          throw new Error(
            `upload_icon: HTTP 500 from HC3${summary ? ` (${summary})` : ''}. The pre-checks (128x128, palette mode) passed at the tool boundary, so HC3 may be in a bad state — try again, or restart HC3 if persistent. Raw response: ${errText}`
          );
        }
        throw new Error(
          `upload_icon: HTTP ${response.status}${summary ? ` ${summary}` : ''} — raw response: ${errText || '(empty body)'}`
        );
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
      const attachHint = args.category === 'device'
        ? `Attach with modify_device({deviceId, properties:{deviceIcon: ${fresh.id}}}) — device icons attach by numeric id, not name.`
        : `Attach with modify_${args.category}({${args.category}Id, fields:{icon: "${newName}"}}).`;
      return {
        newName,
        newId: fresh.id,
        category: args.category,
        extension: ext,
        ...(args.deviceTemplate ? { deviceTemplate: args.deviceTemplate } : {}),
        hint: `${attachHint} Re-fetch later via get_icon({category: "${args.category}", name: "${newName}", extension: "${ext}", userIcon: true}).`
      };
    },

    async delete_icon(hc3, args: {
      name: string;
      fileExtension: string;
      category: 'room' | 'scene' | 'device';
      id?: number;
      force?: boolean;
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

      // In-use check. Devices reference an icon by numeric id in
      // properties.deviceIcon; rooms and scenes by their icon field. Deleting
      // one that is still referenced leaves the owner showing a broken or
      // default icon, with nothing to say why — and there is no undo, since
      // the image bytes are gone. Refuse unless the caller opts in.
      const inUse: string[] = [];
      try {
        if (args.category === 'device') {
          const devices: any[] = await hc3.request('/api/devices') as any[];
          for (const d of devices ?? []) {
            if (d?.properties?.deviceIcon === id) inUse.push(`device ${d.id} (${d.name})`);
          }
        } else {
          const owners: any[] = await hc3.request(
            args.category === 'room' ? '/api/rooms' : '/api/scenes'
          ) as any[];
          for (const o of owners ?? []) {
            if (o?.icon === args.name || o?.icon === id || o?.iconId === id) {
              inUse.push(`${args.category} ${o.id} (${o.name})`);
            }
          }
        }
      } catch (e: any) {
        // A failed scan must not read as "nothing is using it".
        if (!args.force) {
          throw new Error(
            `delete_icon: could not verify whether '${args.name}' is still in use (${e.message}). ` +
            'Re-run with force: true to delete anyway.'
          );
        }
      }
      if (inUse.length > 0 && !args.force) {
        throw new Error(
          `delete_icon: '${args.name}' (id ${id}) is still referenced by ${inUse.length} object(s): ${inUse.slice(0, 10).join(', ')}${inUse.length > 10 ? `, and ${inUse.length - 10} more` : ''}. ` +
          'Deleting it would leave them without an icon and the image cannot be recovered. Repoint them first, or re-run with force: true.'
        );
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
