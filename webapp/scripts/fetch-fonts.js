// Downloads the PDF export's Japanese and Traditional Chinese fonts into public/fonts/, so the page serves them itself
// (without them it falls back to cdn.jsdelivr.net). Run once: node scripts/fetch-fonts.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "fonts");
const FONTS = [["noto-sans-jp", "NotoSansJP_400Regular.ttf"], ["noto-sans-tc", "NotoSansTC_400Regular.ttf"]];
fs.mkdirSync(dir, { recursive: true });
for (const [pkg, file] of FONTS) {
  const out = path.join(dir, file);
  if (fs.existsSync(out)) { console.log("have", file); continue; }
  const res = await fetch(`https://cdn.jsdelivr.net/npm/@expo-google-fonts/${pkg}@0.4.3/400Regular/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log("saved", file);
}
