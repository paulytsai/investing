// Netlify build step: stamp script and stylesheet URLs in index.html with the commit
// hash so browsers always fetch the files that belong to this deploy.
import fs from "node:fs";
const file = new URL("../public/index.html", import.meta.url);
const v = (process.env.COMMIT_REF || String(Date.now())).slice(0, 10);
let html = fs.readFileSync(file, "utf8");
html = html.replace(/(href|src)="(\/[^"?]+\.(?:js|css))"/g, (m, attr, path) => `${attr}="${path}?v=${v}"`);
fs.writeFileSync(file, html);
console.log(`stamped assets with v=${v}`);
