// Generates the extension's PNG icons without any image dependency.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/extension/public/icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const accent = [47, 107, 94];
  const white = [255, 255, 255];
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.22;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // Three "form lines"; the last one shorter with a dot (filled field).
  const bars = [
    [0.24, 0.3, 0.76],
    [0.24, 0.48, 0.66],
    [0.24, 0.66, 0.5],
  ];
  const barH = Math.max(1, size * 0.09);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      if (!inRounded(px, py)) {
        raw.writeUInt32BE(0, i);
        continue;
      }
      let color = accent;
      for (const [x0, yc, x1] of bars) {
        if (px >= size * x0 && px <= size * x1 && Math.abs(py - size * yc) <= barH / 2) color = white;
      }
      const dx = px - size * 0.68;
      const dy = py - size * 0.66;
      if (dx * dx + dy * dy <= (size * 0.07) ** 2) color = white;
      raw[i] = color[0];
      raw[i + 1] = color[1];
      raw[i + 2] = color[2];
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) writeFileSync(resolve(outDir, `icon${size}.png`), png(size));
console.log(`Icons written to ${outDir}`);
