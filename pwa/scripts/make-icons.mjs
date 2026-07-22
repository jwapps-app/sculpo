// Regenerates the PNG app icons from public/icon.svg.
//   node scripts/make-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const svg = readFileSync(new URL("../public/icon.svg", import.meta.url));
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

await sharp(svg, { density: 300 }).resize(192, 192).png().toFile(out("pwa-192.png"));
await sharp(svg, { density: 300 }).resize(512, 512).png().toFile(out("pwa-512.png"));
await sharp(svg, { density: 300 }).resize(180, 180).png().toFile(out("apple-touch-icon.png"));

// Maskable: art shrunk into the 80% safe zone on a full-bleed background.
const art = await sharp(svg, { density: 300 }).resize(408, 408).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#232936" },
})
  .composite([{ input: art, gravity: "centre" }])
  .png()
  .toFile(out("maskable-512.png"));

console.log("icons written");
