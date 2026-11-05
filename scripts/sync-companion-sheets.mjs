// Refresh the adapted v0.19.8 crab sheets, including a transparent cell gutter.
// Usage: node --experimental-strip-types scripts/sync-companion-sheets.mjs [reference root]
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { COMPANION_GUTTER, COMPANION_SHEETS } from "../lib/companion-sheets.ts";

const root = resolve(process.argv[2] ?? "dsh-claude-style-master");
const source = resolve(root, "packages/assets/src/mascot/crab");
for (const [name, [frames, , , width, height]] of Object.entries(COMPANION_SHEETS)) {
  for (const suffix of ["", "-ink"]) {
    const file = `${name}${suffix}.png`;
    const { data, info } = await sharp(await readFile(resolve(source, file))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rows = Math.ceil(frames / 8);
    if (info.width !== width * 8 || info.height !== height * rows) throw new Error(`Unexpected sheet geometry: ${file}`);
    const cellWidth = width + COMPANION_GUTTER * 2;
    const cellHeight = height + COMPANION_GUTTER * 2;
    const outWidth = cellWidth * 8;
    const outHeight = cellHeight * rows;
    const output = Buffer.alloc(outWidth * outHeight * 4);
    for (let frame = 0; frame < frames; frame++) {
      const column = frame % 8, row = Math.floor(frame / 8);
      for (let y = 0; y < height; y++) {
        const start = ((row * height + y) * info.width + column * width) * 4;
        const target = ((row * cellHeight + COMPANION_GUTTER + y) * outWidth + column * cellWidth + COMPANION_GUTTER) * 4;
        data.copy(output, target, start, start + width * 4);
      }
    }
    await sharp(output, { raw: { width: outWidth, height: outHeight, channels: 4 } }).png().toFile(resolve("public/claude-companion", file));
  }
}
console.log(`Synced ${Object.keys(COMPANION_SHEETS).length} crab animations (body + ink, ${COMPANION_GUTTER}px gutters).`);
