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

import { inflateSync } from 'node:zlib';

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
