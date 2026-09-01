#!/usr/bin/env node
// Unit test — the PNG codec behind server-side icon compositing.
//
// `fromIcon` (4.26.0) removed base64 from the conversation for an icon reused
// UNCHANGED. It does nothing for one that must be MODIFIED, and the commonest
// modification here is a badge: one existing icon scaled into the corner of
// another. That case still had to leave as base64 and be re-typed back in,
// which cost about two hours in one session and had already happened twice.
//
// The decoder is the risky half. A subtly wrong decode does not throw — it
// produces a plausible image that uploads cleanly and renders wrong on a
// phone, which is the exact failure this repo keeps closing. So the PNGs below
// are hand-built with zlib directly rather than with encodePng: a round-trip
// through my own encoder would pass even if both halves shared a bug.
//
//   node scripts/test/unit-png-compose.mjs

import { strict as assert } from 'node:assert';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const P = await import('../../out/mcp/png.js');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// --- a PNG builder that shares no code with encodePng -----------------------

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
/** rows: array of Buffers, already unfiltered (filter byte 0 is prepended). */
function buildPng({ width, height, bitDepth, colorType, rows, plte, trns, interlace = 0, filters }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[12] = interlace;
  const raw = Buffer.concat(rows.map((r, i) => Buffer.concat([Buffer.from([filters ? filters[i] : 0]), r])));
  const parts = [Buffer.from(P.PNG_SIGNATURE, 'hex'), chunk('IHDR', ihdr)];
  if (plte) parts.push(chunk('PLTE', plte));
  if (trns) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
const px = (r, x, y) => [...r.rgba.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];

// --- colour types, decoded against known pixels -----------------------------

await check('colour type 6 (RGBA) decodes exactly', () => {
  const png = buildPng({
    width: 2, height: 1, bitDepth: 8, colorType: 6,
    rows: [Buffer.from([10, 20, 30, 255, 40, 50, 60, 128])],
  });
  const r = P.decodePng(png, 'rgba');
  assert.deepEqual(px(r, 0, 0), [10, 20, 30, 255]);
  assert.deepEqual(px(r, 1, 0), [40, 50, 60, 128]);
});

await check('colour type 2 (RGB) gets opaque alpha', () => {
  const png = buildPng({
    width: 2, height: 1, bitDepth: 8, colorType: 2,
    rows: [Buffer.from([1, 2, 3, 4, 5, 6])],
  });
  const r = P.decodePng(png, 'rgb');
  assert.deepEqual(px(r, 0, 0), [1, 2, 3, 255]);
  assert.deepEqual(px(r, 1, 0), [4, 5, 6, 255]);
});

await check('colour type 0 (greyscale) fills all three channels', () => {
  const png = buildPng({ width: 2, height: 1, bitDepth: 8, colorType: 0, rows: [Buffer.from([7, 200])] });
  const r = P.decodePng(png, 'grey');
  assert.deepEqual(px(r, 0, 0), [7, 7, 7, 255]);
  assert.deepEqual(px(r, 1, 0), [200, 200, 200, 255]);
});

await check('colour type 4 (greyscale + alpha)', () => {
  const png = buildPng({ width: 2, height: 1, bitDepth: 8, colorType: 4, rows: [Buffer.from([9, 255, 90, 0])] });
  const r = P.decodePng(png, 'grey-alpha');
  assert.deepEqual(px(r, 0, 0), [9, 9, 9, 255]);
  assert.deepEqual(px(r, 1, 0), [90, 90, 90, 0]);
});

await check('colour type 3 (palette) with tRNS', () => {
  const png = buildPng({
    width: 3, height: 1, bitDepth: 8, colorType: 3,
    plte: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]),
    trns: Buffer.from([255, 0]),                 // entry 1 fully transparent
    rows: [Buffer.from([0, 1, 2])],
  });
  const r = P.decodePng(png, 'palette');
  assert.deepEqual(px(r, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(r, 1, 0), [0, 255, 0, 0]);
  assert.deepEqual(px(r, 2, 0), [0, 0, 255, 255], 'missing tRNS entry defaults to opaque');
});

await check('sub-byte palette indices unpack high bits first', () => {
  // 4-bit: one byte holds two pixels. 0x10 => index 1 then index 0.
  const png = buildPng({
    width: 2, height: 1, bitDepth: 4, colorType: 3,
    plte: Buffer.from([1, 1, 1, 2, 2, 2]),
    rows: [Buffer.from([0x10])],
  });
  const r = P.decodePng(png, 'palette4');
  assert.deepEqual(px(r, 0, 0), [2, 2, 2, 255], 'high nibble is the FIRST pixel');
  assert.deepEqual(px(r, 1, 0), [1, 1, 1, 255]);
});

await check('16-bit samples reduce to the high byte', () => {
  const png = buildPng({
    width: 1, height: 1, bitDepth: 16, colorType: 6,
    rows: [Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xff, 0xff])],
  });
  assert.deepEqual(px(P.decodePng(png, 'rgba16'), 0, 0), [0x12, 0x56, 0x9a, 0xff]);
});

// --- filters ---------------------------------------------------------------

await check('all five row filters reconstruct the same image', () => {
  // Two rows of RGBA, filtered every way, must decode identically.
  const w = 2, plain = [Buffer.from([10, 20, 30, 255, 40, 50, 60, 255]),
                        Buffer.from([70, 80, 90, 255, 100, 110, 120, 255])];
  const expected = P.decodePng(buildPng({ width: w, height: 2, bitDepth: 8, colorType: 6, rows: plain }), 'none');

  const bpp = 4, stride = w * 4;
  for (const type of [1, 2, 3, 4]) {
    const enc = plain.map((row, y) => {
      const prev = y > 0 ? plain[y - 1] : Buffer.alloc(stride);
      const out = Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        const sub = type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : pred;
        out[i] = (row[i] - sub) & 0xff;
      }
      return out;
    });
    const got = P.decodePng(buildPng({
      width: w, height: 2, bitDepth: 8, colorType: 6, rows: enc, filters: [type, type],
    }), `filter${type}`);
    assert.equal(Buffer.compare(got.rgba, expected.rgba), 0, `filter ${type} decoded differently`);
  }
});

// --- refusals --------------------------------------------------------------

await check('an interlaced PNG is refused, not guessed at', () => {
  // A wrong de-interlace produces a scrambled image that still uploads.
  const png = buildPng({
    width: 1, height: 1, bitDepth: 8, colorType: 6, interlace: 1,
    rows: [Buffer.from([1, 2, 3, 4])],
  });
  assert.throws(() => P.decodePng(png, 'lace'), /interlaced/i);
});

await check('a corrupt PNG fails through the existing chunk walk', () => {
  const png = buildPng({ width: 1, height: 1, bitDepth: 8, colorType: 6, rows: [Buffer.from([1, 2, 3, 4])] });
  png[30] ^= 0xff;                                    // damage inside a chunk
  assert.throws(() => P.decodePng(png, 'bad'), /CRC|truncated|inflate/i);
});

// --- scaling and compositing ------------------------------------------------

await check('scaling a solid colour preserves it exactly', () => {
  const big = { width: 4, height: 4, rgba: Buffer.alloc(4 * 4 * 4, 0) };
  for (let i = 0; i < 16; i++) big.rgba.set([200, 100, 50, 255], i * 4);
  const small = P.scaleRaster(big, 2, 2);
  assert.equal(small.width, 2);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual([...small.rgba.subarray(i * 4, i * 4 + 4)], [200, 100, 50, 255]);
  }
});

await check('downscaling does not bleed transparent pixels into the colour', () => {
  // The halo bug: averaging straight RGBA blends a transparent pixel's colour
  // (usually black) into its neighbours and fringes the badge edge.
  const src = { width: 2, height: 1, rgba: Buffer.from([255, 255, 255, 255, 0, 0, 0, 0]) };
  const out = P.scaleRaster(src, 1, 1);
  const [r, g, b, a] = [...out.rgba];
  assert.equal(a, 128, 'alpha should average');
  assert.deepEqual([r, g, b], [255, 255, 255], `colour was dragged towards black: ${r},${g},${b}`);
});

await check('a fully transparent badge leaves the base untouched', () => {
  const base = { width: 2, height: 2, rgba: Buffer.alloc(16, 77) };
  const badge = { width: 2, height: 2, rgba: Buffer.alloc(16, 0) };
  const out = P.compositeOver(base, badge, 0, 0);
  assert.equal(Buffer.compare(out.rgba, base.rgba), 0);
});

await check('an opaque badge replaces exactly its own footprint', () => {
  const base = { width: 4, height: 4, rgba: Buffer.alloc(64, 0) };
  for (let i = 0; i < 16; i++) base.rgba.set([10, 10, 10, 255], i * 4);
  const badge = { width: 2, height: 2, rgba: Buffer.alloc(16) };
  for (let i = 0; i < 4; i++) badge.rgba.set([250, 0, 0, 255], i * 4);
  const at = P.placeBadge(base, badge, 'bottom-right', 0);
  assert.deepEqual(at, { x: 2, y: 2 });
  const out = P.compositeOver(base, badge, at.x, at.y);
  assert.deepEqual(px(out, 3, 3), [250, 0, 0, 255], 'badge missing');
  assert.deepEqual(px(out, 0, 0), [10, 10, 10, 255], 'base damaged outside the badge');
  assert.deepEqual(px(out, 1, 1), [10, 10, 10, 255]);
});

await check('a badge is clipped, not wrapped, when it overruns the edge', () => {
  const base = { width: 2, height: 2, rgba: Buffer.alloc(16, 0) };
  const badge = { width: 2, height: 2, rgba: Buffer.alloc(16, 255) };
  const out = P.compositeOver(base, badge, 1, 1);
  assert.deepEqual(px(out, 0, 0), [0, 0, 0, 0], 'wrapped around the edge');
  assert.deepEqual(px(out, 1, 1), [255, 255, 255, 255]);
});

await check('every corner lands inside the base, with the margin applied', () => {
  const base = { width: 100, height: 100, rgba: Buffer.alloc(40000) };
  const badge = { width: 20, height: 20, rgba: Buffer.alloc(1600) };
  assert.deepEqual(P.placeBadge(base, badge, 'top-left', 5), { x: 5, y: 5 });
  assert.deepEqual(P.placeBadge(base, badge, 'top-right', 5), { x: 75, y: 5 });
  assert.deepEqual(P.placeBadge(base, badge, 'bottom-left', 5), { x: 5, y: 75 });
  assert.deepEqual(P.placeBadge(base, badge, 'bottom-right', 5), { x: 75, y: 75 });
  assert.deepEqual(P.placeBadge(base, badge, 'centre', 5), { x: 40, y: 40 });
});

// --- end to end against a real file -----------------------------------------

await check('a real 128x128 icon round-trips and re-encodes no larger', () => {
  const src = readFileSync(resolve(ROOT, 'icon.png'));
  const a = P.decodePng(src, 'icon.png');
  assert.equal(a.width, 128);
  assert.equal(a.height, 128);
  const enc = P.encodePng(a);
  // The output must pass the same validator uploads are held to.
  const info = P.inspectPng(enc, 'encoded');
  assert.equal(info.colorType, 6);
  assert.equal(info.bitDepth, 8);
  assert.equal(Buffer.compare(P.decodePng(enc, 're').rgba, a.rgba), 0);
  // Filter selection is not decoration: unfiltered output is several times
  // bigger, and these sit on a gateway with limited flash.
  assert.ok(enc.length <= src.length, `re-encode grew: ${enc.length} > ${src.length}`);
});


// ---------------------------------------------------------------------------
// The tool path: overlay resolves both images gateway-side and never asks the
// caller for bytes it could fetch itself.
// ---------------------------------------------------------------------------

const { icons } = await import('../../out/mcp/tools/icons.js');

const solid = (w, h, rgba) => {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * 4);
    for (let x = 0; x < w; x++) row.set(rgba, x * 4);
    rows.push(row);
  }
  return buildPng({ width: w, height: h, bitDepth: 8, colorType: 6, rows });
};

// Serves two icons and captures the multipart body that would reach HC3.
function fakeHc3(sent) {
  const base = solid(128, 128, [0, 0, 255, 255]);
  const badge = solid(64, 64, [255, 0, 0, 255]);
  return {
    async request(endpoint, method = 'GET', body, opts) {
      if (endpoint === '/api/icons' && method === 'GET') return { device: [], room: [], scene: [] };
      return { device: [], room: [], scene: [] };
    },
    async rawGet(path) {
      if (path.includes('BASE')) return { buf: base, ext: 'png' };
      if (path.includes('BADGE')) return { buf: badge, ext: 'png' };
      throw new Error('no such icon: ' + path);
    },
    config: { host: 'stub', port: 80, username: 'u', password: 'p' },
    sent,
  };
}

await check('overlay is refused for SVG rather than half-done', async () => {
  // Compositing SVG means rasterising (losing the point of SVG) or splicing
  // XML. Neither is done here, so it must say so.
  const err = await icons.handlers.upload_icon(fakeHc3([]), {
    category: 'room', mime: 'image/svg+xml', base64: Buffer.from('<svg/>').toString('base64'),
    overlay: { base64: 'AAAA' },
  }).then(() => null, e => e);
  assert.ok(err, 'expected a refusal');
  assert.match(err.message, /overlay is only supported for PNG/);
});

await check('overlay argument guards refuse before any work', async () => {
  const bad = async over => (await icons.handlers.upload_icon(fakeHc3([]), {
    category: 'room', mime: 'image/png', base64: solid(8, 8, [1, 2, 3, 255]).toString('base64'),
    overlay: over,
  }).then(() => null, e => e))?.message ?? '';
  assert.match(await bad({}), /needs base64 or fromIcon/);
  assert.match(await bad({ base64: 'A', fromIcon: { icon: 'X' } }), /not both/);
  assert.match(await bad({ base64: 'A', scale: 0 }), /scale must be greater than 0/);
  assert.match(await bad({ base64: 'A', scale: 2 }), /scale must be greater than 0/);
  assert.match(await bad({ base64: 'A', margin: -1 }), /margin must be a non-negative/);
  assert.match(await bad({ base64: 'A', margin: 1.5 }), /margin must be a non-negative/);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll png-compose checks passed');
process.exit(failures ? 1 : 0);
