// Key/value storage. Uses Netlify Blobs when running on Netlify; falls back to a
// file-backed store under .data/ for local development (scripts/dev.mjs).
import fs from "node:fs/promises";
import path from "node:path";

let blobsModule = null;
let blobsAvailable = null;

async function loadBlobs() {
  if (blobsModule) return blobsModule;
  blobsModule = await import("@netlify/blobs");
  return blobsModule;
}

async function blobsReady() {
  if (blobsAvailable !== null) return blobsAvailable;
  try {
    const { getStore } = await loadBlobs();
    const s = getStore({ name: "healthcheck", consistency: "strong" });
    await s.get("ping");
    blobsAvailable = true;
  } catch {
    blobsAvailable = false;
  }
  return blobsAvailable;
}

function safeKey(key) {
  return encodeURIComponent(key);
}

class FileStore {
  constructor(name) {
    this.dir = path.join(process.cwd(), ".data", name);
  }
  async _file(key) {
    await fs.mkdir(this.dir, { recursive: true });
    return path.join(this.dir, safeKey(key) + ".json");
  }
  async get(key) {
    try {
      const raw = await fs.readFile(await this._file(key), "utf8");
      return JSON.parse(raw).value;
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async getWithMetadata(key) {
    try {
      const raw = await fs.readFile(await this._file(key), "utf8");
      const parsed = JSON.parse(raw);
      return { data: parsed.value, metadata: parsed.metadata || {} };
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async set(key, value, { metadata = {}, onlyIfNew = false } = {}) {
    const file = await this._file(key);
    if (onlyIfNew) {
      try {
        await fs.writeFile(file, JSON.stringify({ value, metadata }), { flag: "wx" });
        return { modified: true };
      } catch (e) {
        if (e.code === "EEXIST") return { modified: false };
        throw e;
      }
    }
    await fs.writeFile(file, JSON.stringify({ value, metadata }));
    return { modified: true };
  }
  async delete(key) {
    try {
      await fs.unlink(await this._file(key));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  async list(prefix = "") {
    try {
      const names = await fs.readdir(this.dir);
      return names
        .filter((n) => n.endsWith(".json"))
        .map((n) => decodeURIComponent(n.slice(0, -5)))
        .filter((k) => k.startsWith(prefix));
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
}

class BlobStore {
  constructor(store) {
    this.store = store;
  }
  async get(key) {
    const v = await this.store.get(key, { type: "json" });
    return v ?? null;
  }
  async getWithMetadata(key) {
    const r = await this.store.getWithMetadata(key, { type: "json" });
    if (!r) return null;
    return { data: r.data, metadata: r.metadata || {} };
  }
  async set(key, value, { metadata = {}, onlyIfNew = false } = {}) {
    const r = await this.store.setJSON(key, value, { metadata, onlyIfNew });
    return { modified: r?.modified !== false };
  }
  async delete(key) {
    await this.store.delete(key);
  }
  async list(prefix = "") {
    const { blobs } = await this.store.list({ prefix });
    return blobs.map((b) => b.key);
  }
}

const cache = new Map();

/** Open a named store ("users", "cache", "jobs", ...). */
// Stores are created per call rather than cached: a warm function instance that kept a
// store object across invocations would carry an expired Blobs token ("Token expired").
export async function openStore(name) {
  if (await blobsReady()) {
    const { getStore } = await loadBlobs();
    return new BlobStore(getStore({ name, consistency: "strong" }));
  }
  if (cache.has(name)) return cache.get(name);
  const impl = new FileStore(name);
  cache.set(name, impl);
  return impl;
}

/**
 * Cached JSON helper. `ttlSeconds` controls freshness; stale entries are returned
 * when the producer throws so one upstream outage does not blank the page.
 */
export async function cached(key, ttlSeconds, producer, { storeName = "cache", version = "1", force = false } = {}) {
  const store = await openStore(storeName);
  const now = Date.now();
  const fullKey = `v${version}:${key}`;
  const hit = await store.getWithMetadata(fullKey);
  if (!force && hit && hit.metadata?.expiresAt && Number(hit.metadata.expiresAt) > now) {
    return hit.data;
  }
  try {
    const value = await producer();
    await store.set(fullKey, value, { metadata: { expiresAt: String(now + ttlSeconds * 1000), createdAt: String(now) } });
    return value;
  } catch (e) {
    if (hit) return hit.data; // stale but better than nothing
    throw e;
  }
}
