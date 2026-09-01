// PNG structural validation, for the one surface here that moves as binary.
//
// Why this exists: icon bytes reach this server as base64 that a caller has
// often re-emitted by hand, and that transcription corrupts at a low but real
// rate. The previous check read the 8-byte signature and the IHDR width and
// height and stopped, so damage anywhere past byte 24 -- which is almost all
// of the file -- travelled to the gateway intact-looking and surfaced later as
// a tile that renders wrong on a phone.
//
// The order of the checks is the point. PNG carries a CRC32 per chunk, so a
// corrupt chunk can be NAMED and its byte range reported, which is the input a
// caller needs to repair a single character rather than re-fetch a whole
// payload. Only if every chunk is individually intact do we spend the inflate.
//
//   1. signature        cheap, catches "this is not a PNG at all"
//   2. chunk walk       catches truncation and impossible lengths
//   3. per-chunk CRC32  catches and LOCALISES substitution
//   4. IDAT inflate     catches damage the CRC would have caught, if a CRC
//                       had ever been recomputed over damaged data
//   5. raster length    catches an IDAT that inflates to the wrong size
//
// Step 4 is not redundant with step 3. A payload that has been re-encoded or
// repaired by a well-meaning tool can carry consistent CRCs over wrong data.
// Inflating is the only way to prove the compressed stream is really a stream.

import { inflateSync, deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Channels per pixel for each PNG colour type. Index is the colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export interface PngChunk {
  type: string;
  /** Offset of the chunk's length field within the file. */
  offset: number;
  length: number;
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  chunks: PngChunk[];
}

export const PNG_SIGNATURE = '89504e470d0a1a0a';

/**
 * Validate a PNG structurally and return what its header declares.
 *
 * Throws with a message naming WHERE the file is damaged, because "this PNG is
 * corrupt" sends someone back to re-copy 15 KB while "chunk 3 (IDAT) at byte
 * 1024 fails CRC" points at the 8 KB that is fine and the range that is not.
 *
 * `label` prefixes every message so a failure inside an 11-image state set
 * says which image, not just that one of them was bad.
 */
export function inspectPng(bytes: Buffer, label: string): PngInfo {
  const fail = (msg: string): never => {
    throw new Error(`${label} ${msg}`);
  };

  if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    return fail(
      'is not a PNG: the 8-byte signature is missing or wrong. If this came from a base64 payload, ' +
      'the most likely cause is a truncated or misaligned copy rather than the wrong file.',
    );
  }

  const chunks: PngChunk[] = [];
  const idatParts: Buffer[] = [];
  let info: Omit<PngInfo, 'chunks'> | undefined;
  let sawIend = false;
  let offset = 8;

  while (offset < bytes.length) {
    // A chunk is length(4) + type(4) + data(length) + crc(4).
    if (offset + 8 > bytes.length) {
      return fail(
        `is truncated: ${bytes.length - offset} trailing byte(s) at offset ${offset} cannot hold a chunk header. ` +
        'The file ends mid-structure, which means bytes were lost rather than altered — re-fetch rather than repair.',
      );
    }
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');

    if (!/^[A-Za-z]{4}$/.test(type)) {
      return fail(
        `has a corrupt chunk type at byte ${offset + 4}: ${JSON.stringify(type)} is not four letters. ` +
        'Either the preceding chunk declared a wrong length or these bytes are damaged.',
      );
    }
    const end = offset + 12 + length;
    if (end > bytes.length) {
      return fail(
        `is truncated: chunk '${type}' at byte ${offset} declares ${length} bytes of data, which runs ` +
        `${end - bytes.length} byte(s) past the end of the file (${bytes.length} bytes total). ` +
        'A declared length longer than the file means the copy is incomplete: bytes were lost rather than altered, so re-fetch rather than repair.',
      );
    }

    const declared = bytes.readUInt32BE(end - 4);
    const actual = crc32(bytes.subarray(offset + 4, end - 4));
    if (declared !== actual) {
      return fail(
        `fails CRC on chunk '${type}' at byte ${offset} (${length} bytes of data): the file declares ` +
        `${declared.toString(16).padStart(8, '0')} and the data hashes to ${actual.toString(16).padStart(8, '0')}. ` +
        `The damage is inside bytes ${offset + 8}..${end - 5} and nothing outside that range is implicated. ` +
        'Everything before this chunk passed, so a single-character repair is worth trying over that range before re-fetching.',
      );
    }

    chunks.push({ type, offset, length });

    if (chunks.length === 1 && type !== 'IHDR') {
      return fail(`does not start with IHDR: the first chunk is '${type}'. PNG requires IHDR first.`);
    }

    if (type === 'IHDR') {
      if (length !== 13) return fail(`has an IHDR of ${length} bytes; PNG requires exactly 13.`);
      const d = offset + 8;
      info = {
        width: bytes.readUInt32BE(d),
        height: bytes.readUInt32BE(d + 4),
        bitDepth: bytes[d + 8],
        colorType: bytes[d + 9],
        interlace: bytes[d + 12],
      };
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(offset + 8, end - 4));
    } else if (type === 'IEND') {
      sawIend = true;
      // Trailing bytes after IEND are ignored: some encoders pad, and it is
      // not a corruption signal worth failing an otherwise sound file over.
      break;
    }

    offset = end;
  }

  if (!info) return fail('has no IHDR chunk.');
  if (!sawIend) {
    return fail(
      'has no IEND chunk: every chunk present passed its CRC, but the file simply stops. ' +
      'That is truncation, not substitution — re-fetch; there is nothing to repair.',
    );
  }
  if (idatParts.length === 0) {
    return fail('has no IDAT chunk, so it carries a header and no image data.');
  }

  // The compressed stream must really be one. A CRC proves the bytes are the
  // bytes that were written; only inflating proves they were ever valid.
  let raster: Buffer;
  try {
    raster = inflateSync(Buffer.concat(idatParts));
  } catch (e: any) {
    return fail(
      `has an IDAT stream that will not inflate (${e?.message ?? e}), despite every chunk passing its CRC. ` +
      'That combination means the file was damaged and then re-checksummed, so the CRCs agree with the damage. ' +
      'Re-fetch the original rather than trying to repair this copy.',
    );
  }

  // Adam7 lays the raster out as seven sub-images, so the flat formula below
  // does not apply. Skip the check rather than reject the file: the goal here
  // is catching corruption, not enforcing the parts of the spec HC3 tolerates.
  if (info.interlace === 0) {
    const channels = CHANNELS[info.colorType];
    if (channels !== undefined && info.bitDepth > 0) {
      const bitsPerPixel = channels * info.bitDepth;
      const bytesPerRow = Math.ceil((info.width * bitsPerPixel) / 8);
      const expected = info.height * (bytesPerRow + 1);   // +1 filter byte per row
      if (raster.length !== expected) {
        return fail(
          `inflates to ${raster.length} bytes where its header describes ${expected} ` +
          `(${info.width}x${info.height}, colour type ${info.colorType}, ${info.bitDepth}-bit). ` +
          'The compressed stream is valid but decodes to the wrong amount of data, so the header and the ' +
          'image body disagree — most likely two different files spliced together.',
        );
      }
    }
  }

  return { ...info, chunks };
}

// ---------------------------------------------------------------------------
// Decode / compose / encode
//
// Why this exists at all. `fromIcon` (4.26.0) removed base64 from the
// conversation for an icon reused UNCHANGED — the bytes go gateway to gateway
// and never pass through a model. It does nothing for an icon that must be
// MODIFIED, and the commonest modification here is a badge: one existing icon
// scaled into the corner of another. That case still had to leave via get_icon
// as base64, get edited locally, and be re-typed back in.
//
// The measured cost of that round trip, from the finding that prompted this:
// roughly two hours in one session, almost all of it transcription,
// verification and repair rather than design. Transcription accuracy depends
// on DISTANCE from the tool result — copying straight from a fresh result
// succeeded twice, copying the same payload from further back in the same
// conversation failed three times, twice with damage that single-character
// repair could not recover.
//
// So the composite happens here, server-side, and the bytes never leave.
//
// No new dependencies: node's zlib does the deflate, everything else is in
// this file. That is a deliberate constraint of this fork, not an accident.
// ---------------------------------------------------------------------------

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major, not premultiplied. */
  rgba: Buffer;
}

/** Paeth predictor, per the PNG spec. Shared by decode and encode. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode a PNG to straight RGBA.
 *
 * Runs `inspectPng` first, so a damaged file is reported by the existing
 * chunk-and-CRC walk — which names the byte range at fault — rather than
 * failing somewhere inside a filter loop with nothing useful to say.
 *
 * Interlaced files are REFUSED rather than mis-decoded. Adam7 lays the raster
 * out as seven sub-images and the flat row walk below would silently produce
 * a scrambled image, which is the worst possible outcome for something whose
 * whole purpose is to stop corrupt icons reaching a tile.
 */
export function decodePng(bytes: Buffer, label: string): Raster {
  const info = inspectPng(bytes, label);
  const fail = (msg: string): never => { throw new Error(`${label} ${msg}`); };

  if (info.interlace !== 0) {
    return fail(
      'is interlaced (Adam7), which this server does not decode. Re-save it non-interlaced ' +
      '(e.g. `magick in.png -interlace none out.png`). Refused rather than guessed at: a wrong ' +
      'de-interlace produces a scrambled image that still uploads and still renders.',
    );
  }
  if (info.bitDepth !== 8 && info.bitDepth !== 16 &&
      !(info.colorType === 3 && [1, 2, 4].includes(info.bitDepth))) {
    return fail(`has bit depth ${info.bitDepth} with colour type ${info.colorType}, which this server does not decode.`);
  }

  // Re-collect what inspectPng already walked. Cheap at icon sizes, and it
  // keeps that function a pure validator rather than making it return
  // everything every caller might want.
  const idat: Buffer[] = [];
  let plte: Buffer | undefined;
  let trns: Buffer | undefined;
  for (const c of info.chunks) {
    const data = bytes.subarray(c.offset + 8, c.offset + 8 + c.length);
    if (c.type === 'IDAT') idat.push(data);
    else if (c.type === 'PLTE') plte = data;
    else if (c.type === 'tRNS') trns = data;
  }
  const raw = inflateSync(Buffer.concat(idat));

  const channels = CHANNELS[info.colorType];
  if (channels === undefined) return fail(`has unsupported colour type ${info.colorType}.`);
  const bpp = Math.ceil((channels * info.bitDepth) / 8);          // filter offset, min 1
  const bytesPerRow = Math.ceil((info.width * channels * info.bitDepth) / 8);

  // Undo the per-row filters in place.
  const lines = Buffer.alloc(info.height * bytesPerRow);
  let pos = 0;
  for (let y = 0; y < info.height; y++) {
    const filter = raw[pos++];
    const row = lines.subarray(y * bytesPerRow, (y + 1) * bytesPerRow);
    raw.copy(row, 0, pos, pos + bytesPerRow);
    pos += bytesPerRow;
    const prev = y > 0 ? lines.subarray((y - 1) * bytesPerRow, y * bytesPerRow) : null;
    for (let i = 0; i < bytesPerRow; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      switch (filter) {
        case 0: break;
        case 1: row[i] = (row[i] + a) & 0xff; break;
        case 2: row[i] = (row[i] + b) & 0xff; break;
        case 3: row[i] = (row[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: row[i] = (row[i] + paeth(a, b, c)) & 0xff; break;
        default: return fail(`uses filter type ${filter} on row ${y}; PNG defines 0-4.`);
      }
    }
  }

  // Expand whatever the file holds into straight RGBA.
  const out = Buffer.alloc(info.width * info.height * 4);
  const step = info.bitDepth === 16 ? 2 : 1;      // 16-bit: keep the high byte
  const sample = (row: Buffer, index: number): number => row[index * step];

  for (let y = 0; y < info.height; y++) {
    const row = lines.subarray(y * bytesPerRow, (y + 1) * bytesPerRow);
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (info.colorType === 3) {
        // Sub-byte indices pack several pixels per byte, high bits first.
        let idx: number;
        if (info.bitDepth === 8) {
          idx = row[x];
        } else {
          const per = 8 / info.bitDepth;
          const shift = 8 - info.bitDepth * ((x % per) + 1);
          idx = (row[Math.floor(x / per)] >> shift) & ((1 << info.bitDepth) - 1);
        }
        if (!plte || idx * 3 + 2 >= plte.length) return fail(`references palette entry ${idx}, which its PLTE does not contain.`);
        r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
        a = trns && idx < trns.length ? trns[idx] : 255;
      } else if (info.colorType === 0) {
        r = g = b = sample(row, x);
      } else if (info.colorType === 4) {
        r = g = b = sample(row, x * 2);
        a = sample(row, x * 2 + 1);
      } else if (info.colorType === 2) {
        r = sample(row, x * 3); g = sample(row, x * 3 + 1); b = sample(row, x * 3 + 2);
      } else {
        r = sample(row, x * 4); g = sample(row, x * 4 + 1);
        b = sample(row, x * 4 + 2); a = sample(row, x * 4 + 3);
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return { width: info.width, height: info.height, rgba: out };
}

/**
 * Box-downscale a raster, averaging in PREMULTIPLIED space.
 *
 * Averaging straight RGBA blends the colour of fully transparent pixels into
 * their neighbours, which fringes the edge of a badge with whatever the
 * transparent background happened to be — usually black. Premultiplying first
 * weights each pixel's colour by its own alpha, so invisible pixels contribute
 * nothing, and the result is un-premultiplied at the end.
 */
export function scaleRaster(src: Raster, width: number, height: number): Raster {
  if (width < 1 || height < 1) throw new Error(`scaleRaster: target ${width}x${height} is empty.`);
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * src.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * src.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / width));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < src.height; sy++) {
        for (let sx = x0; sx < x1 && sx < src.width; sx++) {
          const o = (sy * src.width + sx) * 4;
          const sa = src.rgba[o + 3] / 255;
          r += src.rgba[o] * sa; g += src.rgba[o + 1] * sa; b += src.rgba[o + 2] * sa;
          a += src.rgba[o + 3];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      const alpha = n ? a / n : 0;
      const unpre = alpha > 0 ? 255 / alpha : 0;
      out[o] = n ? Math.round((r / n) * unpre) : 0;
      out[o + 1] = n ? Math.round((g / n) * unpre) : 0;
      out[o + 2] = n ? Math.round((b / n) * unpre) : 0;
      out[o + 3] = Math.round(alpha);
    }
  }
  return { width, height, rgba: out };
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'centre';

/** Standard source-over composite of `badge` onto a copy of `base`. */
export function compositeOver(base: Raster, badge: Raster, x0: number, y0: number): Raster {
  const out = Buffer.from(base.rgba);
  for (let y = 0; y < badge.height; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= base.height) continue;
    for (let x = 0; x < badge.width; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= base.width) continue;
      const s = (y * badge.width + x) * 4;
      const d = (ty * base.width + tx) * 4;
      const sa = badge.rgba[s + 3] / 255;
      if (sa === 0) continue;
      const da = out[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        out[d + c] = Math.round((badge.rgba[s + c] * sa + out[d + c] * da * (1 - sa)) / oa);
      }
      out[d + 3] = Math.round(oa * 255);
    }
  }
  return { width: base.width, height: base.height, rgba: out };
}

/** Where a badge of this size sits in a base of that size, given a corner. */
export function placeBadge(base: Raster, badge: Raster, corner: Corner, margin: number): { x: number; y: number } {
  const right = base.width - badge.width - margin;
  const bottom = base.height - badge.height - margin;
  switch (corner) {
    case 'top-left': return { x: margin, y: margin };
    case 'top-right': return { x: right, y: margin };
    case 'bottom-left': return { x: margin, y: bottom };
    case 'centre': return {
      x: Math.round((base.width - badge.width) / 2),
      y: Math.round((base.height - badge.height) / 2),
    };
    default: return { x: right, y: bottom };
  }
}

/**
 * Encode straight RGBA as an 8-bit RGBA PNG.
 *
 * Always colour type 6: HC3 accepts RGBA (verified — every user icon already
 * on a live gateway is RGBA), and choosing a narrower type to save bytes would
 * mean quantising, which is a way to get the image subtly wrong for a saving
 * that does not matter at 128x128.
 *
 * Rows are filtered by the standard minimum-sum-of-absolute-differences
 * heuristic across all five filter types. That is not premature: an unfiltered
 * icon deflates to several times the size, and these are stored on a gateway
 * with limited flash.
 */
export function encodePng(r: Raster): Buffer {
  const bpp = 4;
  const stride = r.width * bpp;
  const filtered = Buffer.alloc(r.height * (stride + 1));
  const candidate = Buffer.alloc(stride);
  let out = 0;

  for (let y = 0; y < r.height; y++) {
    const row = r.rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? r.rgba.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0, bestSum = Infinity, best = Buffer.alloc(stride);

    for (let type = 0; type <= 4; type++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= bpp ? prev[i - bpp] : 0;
        let v: number;
        switch (type) {
          case 0: v = row[i]; break;
          case 1: v = row[i] - a; break;
          case 2: v = row[i] - b; break;
          case 3: v = row[i] - ((a + b) >> 1); break;
          default: v = row[i] - paeth(a, b, c);
        }
        candidate[i] = v & 0xff;
        // Signed magnitude: the heuristic estimates entropy, so -1 and 255
        // must count the same.
        sum += candidate[i] < 128 ? candidate[i] : 256 - candidate[i];
      }
      if (sum < bestSum) { bestSum = sum; bestType = type; candidate.copy(best); }
    }
    filtered[out++] = bestType;
    best.copy(filtered, out);
    out += stride;
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.width, 0);
  ihdr.writeUInt32BE(r.height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // deflate, adaptive filter, no interlace

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE, 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
