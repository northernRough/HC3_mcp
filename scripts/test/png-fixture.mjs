// Real PNG fixtures for the icon tests.
//
// These used to be 40-byte buffers carrying a signature and an IHDR and
// nothing else -- not PNGs, just the handful of bytes the old validator
// happened to read. That was fine while the validator read two integers out
// of the header, and it is exactly the kind of fixture that lets a real
// corruption bug through: a test suite whose "valid PNG" would be rejected by
// any decoder cannot tell you whether your validator accepts valid PNGs.
//
// So these are genuine: correct per-chunk CRC32, a real deflate stream, and a
// raster whose length matches what the header declares.

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * A structurally valid PNG. Defaults to the shape HC3 requires (128x128);
 * pass width/height to build one it will reject, or colorType to vary the
 * bytes so two fixtures do not hash alike.
 */
export function realPng({ width = 128, height = 128, bitDepth = 8, colorType = 6, fill = 0 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace: none, so the raster length check applies

  const bytesPerRow = Math.ceil((width * CHANNELS[colorType] * bitDepth) / 8);
  const raster = Buffer.alloc(height * (bytesPerRow + 1), fill);
  for (let y = 0; y < height; y++) raster[y * (bytesPerRow + 1)] = 0;   // filter: None

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raster)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The same, base64-encoded, which is how the tools take it. */
export function realPng64(opts) {
  return realPng(opts).toString('base64');
}

/**
 * Flip one byte, leaving the length untouched.
 *
 * This is the failure the whole validator exists for: a hand-copied base64
 * payload that corrupts a character or two and stays exactly as long as the
 * original, so every length-based check agrees while the image is wrong.
 */
export function corruptOneByte(bytes, offset) {
  const damaged = Buffer.from(bytes);
  damaged[offset] = damaged[offset] ^ 0xff;
  return damaged;
}
