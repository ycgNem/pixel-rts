// Minimal PNG reader/writer for the art scripts (no dependencies). Reads 8/16-bit gray, RGB,
// palette, gray+alpha and RGBA, non-interlaced; writes 8-bit RGBA.
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** @returns {{ w: number, h: number, data: Uint8Array }} RGBA, 4 bytes per pixel */
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), t = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (t === 'IHDR') [w, h, depth, type, interlace] = [d.readUInt32BE(0), d.readUInt32BE(4), d[8], d[9], d[12]];
    else if (t === 'PLTE') plte = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    o += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNGs are not supported; re-save without interlacing');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error('unsupported PNG color type ' + type);
  const bitsPP = ch * depth, bpp = Math.max(1, bitsPP >> 3), stride = Math.ceil((w * bitsPP) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(stride * h);
  // undo the per-row filters
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0, b = y ? px[dst - stride + i] : 0, c = i >= bpp && y ? px[dst - stride + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  const sample = (y, i) => {
    // i-th sample of row y, scaled to 0..255
    if (depth === 8) return px[y * stride + i];
    if (depth === 16) return px[y * stride + i * 2];
    const bit = i * depth, v = (px[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = (y * w + x) * 4;
      if (type === 3) {
        const k = sample(y, x);
        out[q] = plte[k * 3]; out[q + 1] = plte[k * 3 + 1]; out[q + 2] = plte[k * 3 + 2];
        out[q + 3] = trns && k < trns.length ? trns[k] : 255;
      } else if (type === 0 || type === 4) {
        const g = sample(y, x * ch);
        out[q] = out[q + 1] = out[q + 2] = g;
        out[q + 3] = type === 4 ? sample(y, x * ch + 1) : 255;
      } else {
        out[q] = sample(y, x * ch); out[q + 1] = sample(y, x * ch + 1); out[q + 2] = sample(y, x * ch + 2);
        out[q + 3] = type === 6 ? sample(y, x * ch + 3) : 255;
      }
    }
  return { w, h, data: out };
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA pixels (Uint8Array, 4 bytes per pixel) as an 8-bit RGBA PNG. */
export function encodePNG(w, h, data) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Scale RGBA up by a whole factor (nearest neighbor), for previews. */
export function upscale(img, k) {
  const { w, h, data } = img, out = new Uint8Array(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++)
    for (let x = 0; x < w * k; x++) out.set(data.subarray(((((y / k) | 0) * w + ((x / k) | 0)) * 4), ((((y / k) | 0) * w + ((x / k) | 0)) * 4) + 4), (y * w * k + x) * 4);
  return { w: w * k, h: h * k, data: out };
}
