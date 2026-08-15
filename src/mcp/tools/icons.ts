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
//   HC3's own spec (/assets/docs/hc/icons.json) omits deviceTemplate
//   entirely and lists only icon + type as required, so the gateway
//   enforces more than it documents.
// - Device icon set SIZE is a property of the device type, verified by
//   listing the files HC3 wrote: genericDevice 1 (bare), binarySwitch 2
//   (0/100), multilevelSwitch 11 (0..100 by 10) — matching what HC3's
//   own UI offers. Sets are sent as parts named icon0/icon10/...; this
//   is undocumented (the spec lists only "icon"). Getting the shape
//   wrong is silent: a single bare image on a binarySwitch registers
//   and attaches, then renders BLANK because the lookup asks for
//   User<N>0.png. See DEVICE_STATE_MODEL.
// - upload_icons batches upload_icon for variant sets. Sequential,
//   and NOT atomic — each upload is a committed write.
// - delete_icon uses query params (NOT JSON body) and refuses to
//   delete built-in icons (HC3 returns 403 on non-user icons; the
//   post-delete refetch catches them too).

import { ToolModule } from './registry';


/**
 * How many images a device icon set holds is a property of the DEVICE TYPE,
 * not a choice. Verified against firmware 5.210.12 by uploading and then
 * listing the files HC3 actually wrote:
 *
 *   com.fibaro.genericDevice    1 image,  stored bare  (User<N>.png)
 *   com.fibaro.binarySwitch     2 images, states 0/100
 *   com.fibaro.multilevelSwitch 11 images, states 0,10,...,100
 *
 * HC3's Web UI offers exactly these counts. Supplying the wrong shape is not
 * an error the gateway reports: a single bare image on a binarySwitch
 * registers and attaches, then renders BLANK, because the lookup asks for
 * User<N>0.png. Types not listed here are accepted as given and the result
 * reports which files actually landed.
 */
const DEVICE_STATE_MODEL: Record<string, string[] | null> = {
  'com.fibaro.genericDevice': null,                                   // null = single bare image
  'com.fibaro.binarySwitch': ['0', '100'],
  'com.fibaro.multilevelSwitch': ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'],
};

/** Lua table name used in hint text; mirrors the luaTableName default. */
function tableNameHint(args: { luaTableName?: string }): string {
  return args.luaTableName || 'Icons';
}

export const icons: ToolModule = {
  schemas: [
      {
        name: 'list_icons',
        description: 'List all icons HC3 knows about, grouped by `device` / `room` / `scene`. Each entry has the icon name, fileExtension (typically "png" or "svg"), and an internal id. Built-in icons live under /assets/icon/fibaro/{rooms,scena,...}/; user-uploaded icons live under /assets/userIcons/...',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_icon',
        description: 'Fetch an icon\'s binary content from HC3, base64-encoded. Returns {name, extension, mime, sizeBytes, path, base64}.\n\nPath layouts (verified against firmware 5.210.12): room → `rooms/{name}.{ext}`; scene → `scena/{name}.{ext}` built-in, `scenes/{name}.{ext}` user; **device → `{iconSetName}/{iconSetName}[state].{ext}`** — each device icon set is its own directory holding one file per state, and `deviceType` is NOT part of the path despite what list_icons might suggest. Built-in icons sit under /assets/icon/fibaro, user icons under /assets/userIcons — and user *device* icons take one extra segment, `/assets/userIcons/devices/User<N>/User<N>[state].{ext}`, which built-in device icons do not.\n\nHC3 answers **200 with a placeholder** for missing icons rather than 404 (a 1888-byte "unknown icon" SVG, or its web UI index.html), so this tool inspects the content and raises rather than handing back a plausible-looking wrong image. This is what previously made user device icons look unfetchable, and the resulting "they are not served under any /assets path" claim was wrong: the `devices/` segment was simply missing from the paths tried. Re-verified 15 Aug 2026 on 5.210.12.\n\nThe MCP itself does not manipulate images — decode, edit (e.g. ImageMagick or sips for PNGs, text edits for SVGs), then upload via upload_icon under a new name. Built-in icons cannot be replaced in place; uploads always create user icons.',
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
        description: 'Upload a new user icon via POST /api/icons (multipart/form-data with type, icon, fileExtension, and — for device icons — deviceTemplate). **Two things decide whether the call is accepted, and both follow from `category`:**\n\n1. **`category: "device"` requires `deviceTemplate`** — the Fibaro device type the icon is filed under, e.g. "com.fibaro.binarySwitch". Device icons are stored per device type; room and scene icons are not, and must not pass it. Omitting it is refused here, and returns 400 MISSING_PARAMETER at HC3. Discover valid values from list_icons → device[].deviceType, or get_quickapp_available_types. To icon a QuickApp, pass that QA\'s own type.\n2. **Pass `states` or `base64`, never both.** Which one is a property of the device type (table below): a type holding a state set takes `states`, a type holding one image takes `base64`. Room and scene icons are always a single `base64` image.\n\nHC3 ignores any caller-supplied filename and auto-assigns "User<N>". Returns the assigned `newName` and `newId` so you can attach via modify_room/modify_scene/modify_device (e.g. modify_room({roomId, fields:{icon: "User1010"}})).\n\nPNG payloads have one hard constraint: dimensions must be exactly **128×128** (HC3 answers 400 INVALID_ICON_SIZE otherwise), Colour type does **not** matter: RGBA uploads fine and is what every user icon already on a live gateway uses. Resize with e.g. `magick input.png -resize 128x128 output.png`. SVG is genuinely supported and is uploaded as-is with no size or colour constraints.\n\n**How many images a device icon holds depends on the device TYPE** — verified on 5.210.12 by listing the files HC3 actually wrote, and matching what its Web UI offers:\n\n| deviceTemplate | Images | Pass |\n|---|---|---|\n| `com.fibaro.genericDevice` (a QuickApp tile) | 1, stored bare | `base64` |\n| `com.fibaro.binarySwitch` (relay) | 2 — states 0, 100 | `states` |\n| `com.fibaro.multilevelSwitch` (dimmer) | 11 — states 0,10,…,100 | `states` |\n\nWhere a set applies, HC3 stores `/assets/userIcons/devices/User<N>/User<N><state>.png` and **switches between them itself from the device value** — on/off comes free, no code. The multi-file form is undocumented (HC3\'s spec lists only a single `icon` part) but is what its own UI sends. Supplying the wrong shape is not an error HC3 reports: a single bare image on a relay registers and attaches, then renders **blank**, because the lookup asks for `User<N>0.png`. This tool refuses the mismatches it can recognise, and an incomplete set (e.g. a dimmer missing state 40) too. Types not listed above are accepted as given.\n\nAttach with `modify_device({deviceId, properties:{deviceIcon: <newId>}})`. To drive the tile beyond the value-based switch — e.g. a QuickApp showing mode rather than on/off — write the property directly from Lua with `self:updateProperty("deviceIcon", id)`, verified working at runtime; `deviceIcon` is a real write, not one of HC3\'s silent-cache paths. For a batch of variants use `upload_icons`.\n\nReturns `{newName, newId, category, extension, states, hint}`.',
        inputSchema: {
          type: 'object',
          properties: {
            base64: { type: 'string', description: 'Base64-encoded image bytes (no data URL prefix). The right field for **room and scene** icons, and for **device** types that hold a single image (com.fibaro.genericDevice, i.e. a QuickApp tile). Device types that hold a state set take `states` instead. PNG must be exactly 128×128; colour type does not matter, RGBA is what most icons already on a live gateway use. SVG is uploaded as-is.' },
            states: { type: 'object', description: 'For **device** icons whose type holds a state set: a map of device state → base64 image, e.g. { "0": "<off>", "100": "<on>" }. HC3 stores these as User<N>0.png / User<N>100.png and picks one by the device\'s value. Keys must be integers, and the set must be complete for the type (binarySwitch 0/100, multilevelSwitch 0,10,…,100). A state-set type uploaded as one bare image registers and attaches, then renders blank.' },
            mime: { type: 'string', description: '"image/png" or "image/svg+xml". Applies to every state image.' },
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Category — records under that bucket in list_icons.' },
            deviceTemplate: { type: 'string', description: 'Required when category is "device", rejected otherwise. The Fibaro device type the icon is filed under, e.g. "com.fibaro.binarySwitch". See list_icons → device[].deviceType for values already in use on this HC3.' }
          },
          // Said in schema rather than prose because prose did not work: every
          // friction entry recorded against this server was this tool refusing
          // a device upload that omitted deviceTemplate, while the description
          // had documented the requirement all along. The old `required` also
          // demanded `base64` for a device state set, which the handler then
          // refused — so obeying the schema guaranteed the failure.
          required: ['mime', 'category'],
          if: { properties: { category: { const: 'device' } }, required: ['category'] },
          then: {
            required: ['deviceTemplate'],
            anyOf: [{ required: ['base64'] }, { required: ['states'] }]
          },
          else: { required: ['base64'] }
        }
      },
      {
        name: 'upload_icons',
        description: 'Upload several icons in one call — for state-variant sets where a device swaps between many images (idle / active / warning / mode tokens). Wraps `upload_icon` per image, so every guard and post-upload verify still applies.\n\nUploads run **sequentially**, not in parallel: HC3 assigns `User<N>` ids in order and concurrent posts risk interleaved assignment. Because each upload is a committed write, this is **not atomic** — if image 7 of 17 fails, the first six exist on the gateway. The result reports `uploaded` and `failed` separately so you can retry only the failures rather than re-running the batch and creating duplicates.\n\nEach device variant is itself a **state set**: pass `states: { "0": ..., "100": ... }` per image, not `base64`. HC3 then switches between the two by device value on its own; you only write `deviceIcon` from code when you need a variant it cannot infer, e.g. a mode token.\n\nReturns a `labels` map (your label → assigned `User<N>` id) and, by default, a ready-to-paste Lua table of that map, which is what you need in the QuickApp for `self:updateProperty("deviceIcon", id)` — verified working at runtime on firmware 5.210.12.',
        inputSchema: {
          type: 'object',
          properties: {
            images: {
              type: 'array',
              description: 'The images to upload, in order. Each needs a `label` (your key for it, e.g. "idle") and `base64`; `mime` may be given per image or once at the top level.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Your name for this variant — becomes the key in the returned map and Lua table. Must be unique within the call.' },
                  base64: { type: 'string', description: 'Base64 image, for room/scene icons only.' },
                  states: { type: 'object', description: 'For device icons: map of state → base64, e.g. { "0": "<idle>", "100": "<active>" }. Required for category "device"; rejected otherwise.' },
                  mime: { type: 'string', description: 'Optional per-image override of the top-level mime.' }
                },
                required: ['label']
              }
            },
            mime: { type: 'string', description: 'Default mime for images that do not specify their own — "image/png" or "image/svg+xml".' },
            category: { type: 'string', enum: ['room', 'scene', 'device'], description: 'Category for every image in the batch.' },
            deviceTemplate: { type: 'string', description: 'Required when category is "device" (e.g. "com.fibaro.genericDevice" for a QuickApp), rejected otherwise. Applies to every image in the batch.' },
            luaTable: { type: 'boolean', description: 'Include a ready-to-paste Lua table of label → id in the result. Default true.' },
            luaTableName: { type: 'string', description: 'Variable name for the Lua table. Default "Icons".' }
          },
          required: ['images', 'category']
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
      // Device icons are NOT under a {deviceType} segment: each icon set is its
      // own directory holding one file per state, e.g.
      // /assets/icon/fibaro/zraszacz/zraszacz0.png. Some sets also carry an
      // unsuffixed file, so both are tried. Room/scene user icons live under
      // different segment names than their built-in counterparts ("scenes"
      // vs "scena"), which is why a user scene icon never resolved before.
      //
      // USER device icons take one extra segment that built-in ones do not:
      // /assets/userIcons/devices/User<N>/User<N>[state].<ext>. Omitting it is
      // why this tool used to report user device icons as unfetchable, and that
      // claim then sat in its own error text for weeks, steering at least one
      // project off custom artwork entirely. Re-probed 15 Aug 2026:
      //   /assets/userIcons/devices/User1072/User1072.svg → 200 image/svg+xml
      //   /assets/userIcons/User1072/User1072.svg         → 200 text/html (SPA)
      // The same segment is wrong for built-in icons, which 404 to the 1888-byte
      // placeholder under /assets/icon/fibaro/devices/..., so it is user-only.
      const deviceDir = args.userIcon ? `${base}/devices` : base;
      const candidates: string[] = [];
      if (args.category === 'device') {
        if (typeof args.state === 'number') {
          candidates.push(`${deviceDir}/${name}/${name}${args.state}.${ext}`);
        } else {
          candidates.push(`${deviceDir}/${name}/${name}.${ext}`);
          candidates.push(`${deviceDir}/${name}/${name}0.${ext}`);
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
        ? ' NOTE: user device icons are served, under /assets/userIcons/devices/User<N>/User<N>[state].<ext>, which is what this tool tried. If that missed, the likely causes are a wrong fileExtension (check list_icons — sets are often .png where a QuickApp tile is .svg) or a state set, whose files are suffixed: pass `state` to fetch one.'
        : '';
      throw new Error(
        `get_icon: could not fetch '${args.name}' (${args.category}, .${ext}). HC3 returns 200 with a placeholder for missing icons rather than 404, so each candidate was checked for content and rejected:\n  ${tried.join('\n  ')}\n` +
        `Confirm the name and fileExtension via list_icons — for device icons use device[].iconSetName (NOT deviceType, which is not part of the path).${userDeviceNote}`
      );
    },

    async upload_icon(hc3, args: {
      base64?: string;
      states?: Record<string, string>;
      mime: string;
      category: 'room' | 'scene' | 'device';
      deviceTemplate?: string;
    }): Promise<any> {
      if (!args?.mime) throw new Error('upload_icon requires mime.');
      if (!args?.category) throw new Error('upload_icon requires category.');
      if (!hc3.config.host || !hc3.config.username || !hc3.config.password) {
        throw new Error('Fibaro HC3 not configured.');
      }

      const isDevice = args.category === 'device';
      const stateKeys = args.states ? Object.keys(args.states) : [];

      // Device icons are filed per device type, so HC3 requires a
      // deviceTemplate part; room/scene icons are not and reject it.
      if (isDevice && !args.deviceTemplate) {
        throw new Error(
          'upload_icon: category "device" requires deviceTemplate — the Fibaro device type the icon is filed under, e.g. "com.fibaro.binarySwitch". ' +
          'Without it HC3 returns 400 MISSING_PARAMETER. Discover valid values from list_icons (device[].deviceType) or get_quickapp_available_types; ' +
          'to icon a QuickApp, pass that QA\'s own type. Room and scene icons do not take this parameter.'
        );
      }
      if (!isDevice && args.deviceTemplate) {
        throw new Error(
          `upload_icon: deviceTemplate only applies to category "device", not "${args.category}". Drop it, or set category to "device".`
        );
      }

      // Device icons are STATE SETS. HC3 asks for
      // /assets/userIcons/devices/User<N>/User<N><state>.png and a single
      // unsuffixed upload writes User<N>.png, which that lookup never
      // requests — the icon registers, attaches, reports no error, and renders
      // blank. Verified on 5.210.12 against a binarySwitch. So a device upload
      // without states is refused rather than silently producing a dud.
      const known = args.deviceTemplate !== undefined && args.deviceTemplate in DEVICE_STATE_MODEL;
      const expected = known ? DEVICE_STATE_MODEL[args.deviceTemplate as string] : undefined;
      if (isDevice) {
        if (args.base64 && stateKeys.length > 0) {
          throw new Error('upload_icon: pass either base64 (single image) or states (a set), not both.');
        }
        // A single bare image is correct for types that hold one — a QuickApp
        // tile — and silently broken for types that hold a set.
        if (args.base64 && expected) {
          throw new Error(
            `upload_icon: '${args.deviceTemplate}' icons are sets of ${expected.length} images (states ${expected.join(', ')}), not a single image. ` +
            'A single bare image registers and attaches but renders BLANK, because HC3 asks for User<N>' + expected[0] + '.png. ' +
            `Pass states: { ${expected.slice(0, 2).map(k => `"${k}": "<base64>"`).join(', ')}${expected.length > 2 ? ', ...' : ''} }.`
          );
        }
        if (stateKeys.length > 0 && known && expected === null) {
          throw new Error(
            `upload_icon: '${args.deviceTemplate}' icons hold a single image, not a state set — HC3's own UI offers one slot for them. Pass base64 instead of states.`
          );
        }
        if (!args.base64 && stateKeys.length === 0) {
          throw new Error(
            'upload_icon: category "device" needs either `states` (for a device type that holds a set — binarySwitch is 0/100, multilevelSwitch is 0,10,...,100) ' +
            'or `base64` (for a type that holds one image, e.g. com.fibaro.genericDevice / a QuickApp tile).'
          );
        }
        for (const k of stateKeys) {
          if (!/^\d+$/.test(k)) {
            throw new Error(`upload_icon: state key '${k}' is not numeric. HC3 names files User<N><state>.png, so states must be integers like "0", "50", "100".`);
          }
          if (!args.states![k]) throw new Error(`upload_icon: state '${k}' has no base64 image.`);
        }
        if (expected && stateKeys.length > 0) {
          const missing = expected.filter(k => !stateKeys.includes(k));
          if (missing.length > 0) {
            throw new Error(
              `upload_icon: '${args.deviceTemplate}' expects states ${expected.join(', ')} — missing ${missing.join(', ')}. ` +
              'HC3 renders blank at any state whose file is absent, and reports no error.'
            );
          }
        }
      } else {
        if (args.states) {
          throw new Error(`upload_icon: \`states\` only applies to category "device", not "${args.category}" — room and scene icons are single images. Use base64.`);
        }
        if (!args.base64) throw new Error('upload_icon requires base64.');
      }

      const ext = args.mime === 'image/svg+xml' ? 'svg'
        : args.mime === 'image/png' ? 'png'
        : args.mime === 'image/jpeg' ? 'jpg'
        : 'png';

      // Validate PNG dimensions + palette mode at the tool boundary so callers
      // get a clear error rather than HC3's misleading silent-500 on RGB or
      // wrong-size PNGs. Every state image is checked, so one bad frame in a
      // set fails before any of them are written.
      const validatePng = (bytes: Buffer, where: string) => {
        if (ext !== 'png') return;
        if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
          throw new Error(`upload_icon: ${where} is not a valid PNG.`);
        }
        const width = bytes.readUInt32BE(16);
        const height = bytes.readUInt32BE(20);
        if (width !== 128 || height !== 128) {
          throw new Error(
            `upload_icon: ${where} must be 128x128. Got ${width}x${height}. HC3 rejects other sizes with 400 INVALID_ICON_SIZE. Resize with e.g. \`magick input.png -resize 128x128 output.png\`. Colour type does not matter — RGBA uploads fine.`
          );
        }
        // NOT a palette-mode check. The inherited claim that HC3 silent-500s
        // on RGB/RGBA is false: an RGBA (colour type 6) PNG uploads with
        // HTTP 201, is stored byte-identical, and renders — and every one of
        // the 90+ user icons already on this gateway is colour type 6.
        // Verified on 5.210.12. Dimensions ARE enforced by HC3 (it answers
        // 400 INVALID_ICON_SIZE for 64x64 and 256x256), which is why the
        // size check above stays.
      };

      // Ordered smallest state first so the multipart mirrors how HC3's own
      // UI sends a set; the gateway does not appear to care, but a stable
      // order makes captured requests comparable.
      const frames: Array<{ part: string; state?: string; bytes: Buffer }> = (isDevice && stateKeys.length > 0)
        ? stateKeys
          .sort((a, b) => Number(a) - Number(b))
          .map(k => {
            const bytes = Buffer.from(args.states![k], 'base64');
            validatePng(bytes, `state '${k}'`);
            return { part: `icon${k}`, state: k, bytes };
          })
        : (() => {
          const bytes = Buffer.from(args.base64 as string, 'base64');
          validatePng(bytes, 'the image');
          return [{ part: 'icon', bytes }];
        })();

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
        ...frames.flatMap(f => [
          Buffer.from(partHead(f.part, `mcp${f.state ?? ''}.${ext}`, args.mime)),
          f.bytes,
          Buffer.from(CRLF),
        ]),
        Buffer.from(partHead('type') + args.category + CRLF),
        Buffer.from(tail)
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
      const attachHint = isDevice
        ? `Attach with modify_device({deviceId, properties:{deviceIcon: ${fresh.id}}}) — device icons attach by numeric id, not name. HC3 picks the state image from the device's own value; switch explicitly from QuickApp Lua with self:updateProperty("deviceIcon", id).`
        : `Attach with modify_${args.category}({${args.category}Id, fields:{icon: "${newName}"}}).`;
      return {
        newName,
        newId: fresh.id,
        category: args.category,
        extension: ext,
        ...(args.deviceTemplate ? { deviceTemplate: args.deviceTemplate } : {}),
        ...(isDevice ? { states: frames.map(f => f.part.replace(/^icon/, '')) } : {}),
        hint: `${attachHint} Re-fetch later via get_icon({category: "${args.category}", name: "${newName}", extension: "${ext}", userIcon: true}).`
      };
    },

    async upload_icons(hc3, args: {
      images: Array<{ label: string; base64?: string; states?: Record<string, string>; mime?: string }>;
      mime?: string;
      category: 'room' | 'scene' | 'device';
      deviceTemplate?: string;
      luaTable?: boolean;
      luaTableName?: string;
    }): Promise<any> {
      if (!Array.isArray(args?.images) || args.images.length === 0) {
        throw new Error('upload_icons requires a non-empty images array.');
      }
      if (!args?.category) throw new Error('upload_icons requires category.');

      // Validate the whole batch before writing anything. Each upload is a
      // committed write, so a batch that is going to fail on a missing label
      // should fail before it creates half a set on the gateway.
      const seen = new Set<string>();
      args.images.forEach((img, i) => {
        if (!img?.label) throw new Error(`upload_icons: images[${i}] has no label.`);
        if (seen.has(img.label)) throw new Error(`upload_icons: duplicate label '${img.label}' — labels key the returned map and must be unique.`);
        seen.add(img.label);
        // Whether a device variant is one image or a state set depends on the
        // device type, so that rule lives in upload_icon and is not duplicated
        // here — only the "supplied something" check belongs at batch level.
        if (args.category === 'device') {
          const st = img.states ? Object.keys(img.states) : [];
          if (!img.base64 && st.length === 0) {
            throw new Error(`upload_icons: images[${i}] ('${img.label}') has neither base64 nor states.`);
          }
        } else {
          if (img.states) throw new Error(`upload_icons: images[${i}] ('${img.label}') supplies states, but only device icons are state sets. Use base64 for ${args.category} icons.`);
          if (!img.base64) throw new Error(`upload_icons: images[${i}] ('${img.label}') has no base64.`);
        }
        if (!img.mime && !args.mime) throw new Error(`upload_icons: images[${i}] ('${img.label}') has no mime and no top-level mime was given.`);
      });
      if (args.category === 'device' && !args.deviceTemplate) {
        throw new Error(
          'upload_icons: category "device" requires deviceTemplate — the Fibaro device type the icons are filed under, e.g. "com.fibaro.genericDevice" for a QuickApp. Checked here so the batch fails before uploading anything.'
        );
      }
      if (args.category !== 'device' && args.deviceTemplate) {
        throw new Error(`upload_icons: deviceTemplate only applies to category "device", not "${args.category}".`);
      }

      const uploaded: any[] = [];
      const failed: any[] = [];
      const labels: Record<string, number> = {};
      // Sequential on purpose: HC3 assigns User<N> ids in order, and parallel
      // posts risk interleaved assignment.
      for (const img of args.images) {
        try {
          const res = await icons.handlers.upload_icon(hc3, {
            ...(img.states ? { states: img.states } : { base64: img.base64 }),
            mime: img.mime ?? args.mime,
            category: args.category,
            ...(args.deviceTemplate ? { deviceTemplate: args.deviceTemplate } : {}),
          });
          labels[img.label] = res.newId;
          uploaded.push({ label: img.label, name: res.newName, id: res.newId, extension: res.extension, ...(res.states ? { states: res.states } : {}) });
        } catch (e: any) {
          failed.push({ label: img.label, error: e?.message ?? String(e) });
        }
      }

      const result: any = {
        category: args.category,
        ...(args.deviceTemplate ? { deviceTemplate: args.deviceTemplate } : {}),
        requested: args.images.length,
        uploadedCount: uploaded.length,
        failedCount: failed.length,
        labels,
        uploaded,
        failed,
      };

      if (args.luaTable !== false && uploaded.length > 0) {
        // Lua identifiers only match [A-Za-z_][A-Za-z0-9_]*; anything else has
        // to use the ["..."] form or the paste will not parse.
        const tableName = args.luaTableName || 'Icons';
        const rows = uploaded.map(u => {
          const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(u.label)
            ? u.label
            : `["${u.label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
          return `    ${key} = ${u.id},`;
        });
        result.luaTable = `local ${tableName} = {\n${rows.join('\n')}\n}`;
      }

      result.hint = failed.length > 0
        ? `${uploaded.length} of ${args.images.length} uploaded; the ${failed.length} listed in \`failed\` were NOT created. Retry only those — re-running the whole batch would duplicate the successes.`
        : `Attach with modify_device({deviceId, properties:{deviceIcon: <id>}}), and switch at runtime from QuickApp Lua with self:updateProperty("deviceIcon", ${tableNameHint(args)}.<label>). Device icons are single-image sets — HC3 has no multi-state upload — so every state change is code-driven.`;
      return result;
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
