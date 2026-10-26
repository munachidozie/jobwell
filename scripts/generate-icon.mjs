// Generates build/icon.ico (and build/icon.png) with no external dependencies.
// It rasterizes a simple "JW" monogram on a rounded dark tile into an RGBA
// buffer, encodes a PNG with zlib, and wraps it in an ICO container.
//
// This is a PLACEHOLDER. To use a real logo, replace build/icon.svg with your
// artwork, render it to a 256x256 PNG however you like, and either point
// electron-builder at that PNG's .ico, or adapt this script. Re-run with:
//   node scripts/generate-icon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SIZE = 256;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "build");

// --- colors (RGBA) ---
const ACCENT = [0x6b, 0xc1, 0xff, 0xff]; // outer border
const DARK = [0x0f, 0x11, 0x15, 0xff]; // tile
const GREEN = [0x39, 0xd9, 0x8a, 0xff]; // letters
const CLEAR = [0, 0, 0, 0];

const px = Buffer.alloc(SIZE * SIZE * 4);
function set(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

// Rounded-rectangle fill test.
function inRoundRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// Base: transparent, then accent rounded tile, then inset dark tile.
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let c = CLEAR;
    if (inRoundRect(x, y, 0, 0, 255, 255, 48)) c = ACCENT;
    if (inRoundRect(x, y, 20, 20, 235, 235, 36)) c = DARK;
    set(x, y, c);
  }
}

// Draw blocky "JW" from rectangles (simple, dependency-free glyphs).
function rect(x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) set(x, y, color);
}

const T = 16; // stroke thickness
// "J": top bar + vertical stem + bottom hook.
rect(60, 80, 70, T, GREEN); // top bar
rect(104, 80, T, 80, GREEN); // stem
rect(66, 144, 54, T, GREEN); // bottom
rect(60, 120, T, 40, GREEN); // hook up-left

// "W": two V shapes via four diagonals approximated with steps.
function diag(x0, y0, x1, y1, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / steps);
    const y = Math.round(y0 + ((y1 - y0) * s) / steps);
    rect(x, y, T, T, color);
  }
}
diag(150, 80, 166, 160, GREEN);
diag(166, 160, 182, 100, GREEN);
diag(182, 100, 198, 160, GREEN);
diag(198, 160, 214, 80, GREEN);

// --- PNG encode ---
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression/filter/interlace = 0
  // Add a filter byte (0) at the start of each row.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- ICO wrap (single PNG-compressed image) ---
function encodeIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 means 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8); // size of image data
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, pngBuf]);
}

mkdirSync(outDir, { recursive: true });
const png = encodePng(px, SIZE);
writeFileSync(join(outDir, "icon.png"), png);
writeFileSync(join(outDir, "icon.ico"), encodeIco(png, SIZE));
console.log("Wrote build/icon.png and build/icon.ico");
