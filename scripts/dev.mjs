// Minimal local dev server: serves public/ and routes /api/* to the Netlify
// functions (Request -> Response signature) without needing the Netlify CLI.
// Storage falls back to .data/ files. Loads .env from the repo root.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8888);

async function loadDotenv() {
  try {
    const raw = await fs.readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).split(" #")[0].trim().replace(/^['"]|['"]$/g, "");
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {}
}

function compilePath(p) {
  const names = [];
  const re = new RegExp("^" + p.replace(/:([a-zA-Z0-9_]+)/g, (_, n) => (names.push(n), "([^/]+)")) + "/?$");
  return { re, names };
}

async function loadFunctions() {
  const dir = path.join(ROOT, "netlify", "functions");
  const routes = [];
  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith(".mjs")) continue;
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const name = file.replace(/\.mjs$/, "");
    const paths = [`/.netlify/functions/${name}`];
    if (mod.config?.path) paths.push(mod.config.path);
    for (const p of paths) routes.push({ ...compilePath(p), handler: mod.default, background: name.endsWith("-background"), name });
  }
  return routes;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

async function serveStatic(urlPath, res) {
  let file = path.join(ROOT, "public", decodeURIComponent(urlPath));
  try {
    const st = await fs.stat(file);
    if (st.isDirectory()) file = path.join(file, "index.html");
    await fs.access(file);
  } catch {
    file = path.join(ROOT, "public", "index.html");
  }
  const body = await fs.readFile(file);
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(body);
}

async function main() {
  await loadDotenv();
  const routes = await loadFunctions();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const route = routes.find((r) => r.re.test(url.pathname));
    if (!route) return serveStatic(url.pathname, res);
    const m = url.pathname.match(route.re);
    const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const context = { params };
    try {
      if (route.background) {
        res.writeHead(202);
        res.end();
        route.handler(request, context).catch((e) => console.error(`[${route.name}]`, e));
        return;
      }
      const response = await route.handler(request, context);
      const headers = {};
      response.headers.forEach((v, k) => {
        headers[k] = k === "set-cookie" ? response.headers.getSetCookie?.() || v : v;
      });
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error(`[${route.name}]`, e);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error", message: e.message }));
    }
  });
  server.listen(PORT, () => {
    console.log(`dev server on http://localhost:${PORT}`);
    for (const r of routes) console.log("  ", r.re.source);
  });
}
main();
