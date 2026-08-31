#!/usr/bin/env node
// Unit test — PNG structural validation.
//
// The tool-level tests cover what upload_icon does with a bad payload; this
// covers the validator itself, including the cases a real gateway would send
// that a naive walker gets wrong (ancillary chunks, split IDATs, trailing
// bytes after IEND). Over-strictness here is a live risk: a validator that
// refuses valid PNGs is worse than the header-only check it replaced, because
// it fails on files that would have uploaded fine.
//
//   node scripts/test/unit-png.mjs

import { strict as assert } from 'node:assert';
import { deflateSync } from 'node:zlib';
import { inspectPng, crc32 } from '../../out/mcp/png.js';
import { realPng, corruptOneByte } from './png-fixture.mjs';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// A chunk builder, so this test can construct shapes the fixture does not.
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

check('crc32 matches the PNG spec test value', () => {
  // CRC32 of "IEND" with no data, which every PNG in existence carries.
  assert.equal(crc32(Buffer.from('IEND', 'latin1')) >>> 0, 0xae426082);
});

check('a valid PNG passes and reports its header', () => {
  const info = inspectPng(realPng(), 'fixture');
  assert.equal(info.width, 128);
  assert.equal(info.height, 128);
  assert.equal(info.colorType, 6);
  assert.equal(info.bitDepth, 8);
  assert.deepEqual(info.chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND']);
});

check('non-square and non-128 sizes are structurally fine', () => {
  // The validator's job is integrity, not policy. upload_icon applies HC3's
  // 128x128 rule separately, so that a wrong-size file gets the resize advice
  // rather than a corruption message.
  const info = inspectPng(realPng({ width: 64, height: 32 }), 'fixture');
  assert.equal(info.width, 64);
  assert.equal(info.height, 32);
});

check('every colour type the spec defines is accepted', () => {
  for (const colorType of [0, 2, 3, 4, 6]) {
    const info = inspectPng(realPng({ colorType }), `colorType ${colorType}`);
    assert.equal(info.colorType, colorType);
  }
});

check('ancillary chunks are walked, not rejected', () => {
  // Real encoders emit pHYs, tEXt, gAMA and friends. A validator that only
  // knows IHDR/IDAT/IEND would refuse most PNGs in the wild.
  const clean = realPng();
  const iendAt = clean.length - 12;
  const withExtras = Buffer.concat([
    clean.subarray(0, iendAt),
    chunk('tEXt', Buffer.from('Comment\0made by a real encoder', 'latin1')),
    chunk('pHYs', Buffer.from('00000b1200000b120100', 'hex')),
    clean.subarray(iendAt),
  ]);
  const info = inspectPng(withExtras, 'fixture');
  assert.ok(info.chunks.some(c => c.type === 'tEXt'));
  assert.ok(info.chunks.some(c => c.type === 'pHYs'));
});

check('an IDAT split across several chunks inflates as one stream', () => {
  // How every large PNG is actually written. Concatenation has to happen
  // before the inflate, or real files fail.
  const rowStride = 128 * 4 + 1;   // 4 channels + the per-row filter byte
  const raster = Buffer.alloc(128 * rowStride, 0);
  const compressed = deflateSync(raster);
  const mid = Math.floor(compressed.length / 2);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(128, 0); ihdr.writeUInt32BE(128, 4);
  ihdr[8] = 8; ihdr[9] = 6;

  const split = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed.subarray(0, mid)),
    chunk('IDAT', compressed.subarray(mid)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const info = inspectPng(split, 'fixture');
  assert.equal(info.chunks.filter(c => c.type === 'IDAT').length, 2);
});

check('trailing bytes after IEND do not fail the file', () => {
  const padded = Buffer.concat([realPng(), Buffer.from('\n\n')]);
  assert.ok(inspectPng(padded, 'fixture'));
});

check('a one-byte change inside IDAT fails CRC and names the range', () => {
  const clean = realPng();
  const idatAt = clean.indexOf(Buffer.from('IDAT', 'latin1'));
  const damaged = corruptOneByte(clean, idatAt + 8);
  assert.equal(damaged.length, clean.length);
  assert.throws(() => inspectPng(damaged, 'fixture'), (e) => {
    assert.match(e.message, /fails CRC on chunk 'IDAT'/);
    assert.match(e.message, /damage is inside bytes \d+\.\.\d+/);
    return true;
  });
});

check('a one-byte change inside IHDR is caught before the header is trusted', () => {
  // Otherwise a corrupt width sails through as a dimension error, which sends
  // the caller to resize a file whose real problem is that it is damaged.
  const clean = realPng();
  const damaged = corruptOneByte(clean, 18);
  assert.throws(() => inspectPng(damaged, 'fixture'), /fails CRC on chunk 'IHDR'/);
});

check('a wrong signature is reported as not-a-PNG', () => {
  const notPng = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.throws(() => inspectPng(notPng, 'fixture'), /is not a PNG/);
});

check('truncation is distinguished from substitution in the advice given', () => {
  // Different repairs: a substitution is worth a brute-force fix over a named
  // range, a truncation has nothing to repair.
  assert.throws(() => inspectPng(realPng().subarray(0, 60), 'fixture'), (e) => {
    assert.match(e.message, /truncat/i);
    assert.match(e.message, /re-fetch/i);
    assert.ok(!/single-character repair/.test(e.message));
    return true;
  });
});

check('a file that stops before IEND is truncation, not a missing chunk', () => {
  const clean = realPng();
  assert.throws(() => inspectPng(clean.subarray(0, clean.length - 12), 'fixture'), (e) => {
    assert.match(e.message, /IEND/);
    assert.match(e.message, /re-fetch/i);
    return true;
  });
});

check('a valid deflate stream of the wrong length is caught', () => {
  // CRCs all pass and the stream inflates: only the raster-length check sees
  // that the header and the image body describe different images.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(128, 0); ihdr.writeUInt32BE(128, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const tooSmall = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(100))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.throws(() => inspectPng(tooSmall, 'fixture'), (e) => {
    assert.match(e.message, /inflates to 100 bytes where its header describes 65664/);
    return true;
  });
});

check('an interlaced PNG skips the raster-length check rather than failing', () => {
  // Adam7 lays the raster out as seven sub-images, so the flat formula does
  // not apply. Refusing it would reject a file HC3 may well accept.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(128, 0); ihdr.writeUInt32BE(128, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[12] = 1;   // interlace: Adam7
  const interlaced = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(512))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const info = inspectPng(interlaced, 'fixture');
  assert.equal(info.interlace, 1);
});

check('the label prefixes the message, so a bad frame in a set is identifiable', () => {
  assert.throws(
    () => inspectPng(realPng().subarray(0, 40), "upload_icon: state '100'"),
    /^Error: upload_icon: state '100' /,
  );
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll png checks passed');
process.exit(failures ? 1 : 0);
